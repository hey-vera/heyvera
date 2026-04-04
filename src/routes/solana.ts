// src/routes/solana.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyToken } from '@clerk/backend';
import { logger } from '../utils/logger';
import { getDb, getApiKeyByClerkId, createApiKeyForClerk, topUpCreditsForClerk, tryClaimSolanaSignature, releaseClaimSolanaSignature } from '../db/index';
import { sendApiKeyEmail } from '../utils/email';
import { maskApiKey } from '../utils/mask';
import { env } from '../config/index';
import crypto from 'crypto';
import { createSomaReceipt } from '../core/soma-receipt';

export const solanaRouter = new Hono();

// USDC mint on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Receiving wallet — sourced from validated env config
const RECEIVING_WALLET = env.SOLANA_RECEIVING_WALLET ?? '';

import { creditsForDollarsUsdc } from './billing';

// Legacy fixed USDC packages (kept for backwards compat — old clients may still send these)
const USDC_PACKAGES_LEGACY: Record<number, number> = {
  20:   23_500,
  50:   64_200,
  100:  133_750,
  500:  802_500,
  1000: 2_140_000,
};

const VerifySchema = z.object({
  signature: z.string().min(80).max(120).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid base58 signature'),
  expectedUsd: z.number().int().min(5).max(10000),
  replyEmail: z.string().email().optional(),
});

// Processed signatures are persisted to SQLite — survives restarts

// POST /v1/solana/verify
solanaRouter.post('/verify', async (c) => {
  // 1. Require Clerk JWT
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required. Please sign in.', code: 'AUTH_REQUIRED' }, 401);
  }

  const token = authHeader.slice(7);
  let clerkUserId: string;
  let clerkEmail: string;

  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY ?? '',
    });
    clerkUserId = payload.sub;
    // Clerk JWTs don't embed email by default — rely on replyEmail from the request body instead
    clerkEmail = ((payload as Record<string, unknown>).email_address as string ?? '').toLowerCase();
  } catch {
    return c.json({ error: 'Invalid or expired session.', code: 'INVALID_SESSION' }, 401);
  }

  // 2. Parse body
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, 400);
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'INVALID_REQUEST', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { signature, expectedUsd, replyEmail } = parsed.data;

  // Require at least one email source so we can deliver the API key
  if (!clerkEmail && !replyEmail) {
    return c.json({ error: 'Email required — provide replyEmail to receive your API key.', code: 'EMAIL_REQUIRED' }, 400);
  }

  // 3. Calculate credits — use legacy package if exact match, otherwise flexible rate
  const credits = USDC_PACKAGES_LEGACY[expectedUsd] ?? creditsForDollarsUsdc(expectedUsd);

  // 4. Atomic idempotency — claim signature BEFORE async on-chain verification.
  // INSERT OR IGNORE + changes > 0 ensures only ONE concurrent request wins,
  // preventing TOCTOU double-credit if two requests arrive with the same signature.
  if (!tryClaimSolanaSignature(signature)) {
    return c.json({ error: 'Transaction already processed.', code: 'DUPLICATE_TRANSACTION' }, 409);
  }

  // 5. Verify transaction on-chain — try primary RPC, fall back to secondary on failure
  const rpcUrls = [env.SOLANA_RPC_URL, env.SOLANA_RPC_FALLBACK].filter(Boolean) as string[];

  let transferredUsd = 0;

  try {
    const verificationResult = await Promise.race([
      (async () => {
        let tx = null;
        let activeConnection: Connection = new Connection(rpcUrls[0], 'confirmed');
        let lastErr: unknown;
        for (const rpcUrl of rpcUrls) {
          try {
            const conn = new Connection(rpcUrl, 'confirmed');
            tx = await conn.getParsedTransaction(signature, {
              maxSupportedTransactionVersion: 0,
              commitment: 'confirmed',
            });
            if (tx !== null) {
              activeConnection = conn; // reuse for account info lookups
              break;
            }
          } catch (err) {
            lastErr = err;
            logger.warn({ rpcUrl, err }, 'Solana RPC failed, trying fallback');
          }
        }
        if (tx === null && lastErr) throw lastErr;

        const connection = activeConnection;

        if (!tx) {
          return { earlyReturn: c.json({ error: 'Transaction not found. It may still be confirming — wait a few seconds and try again.', code: 'TX_NOT_FOUND' }, 404) } as const;
        }

        if (tx.meta?.err) {
          return { earlyReturn: c.json({ error: 'Transaction failed on-chain.', code: 'TX_FAILED' }, 400) } as const;
        }

        // Walk through token transfers to find USDC to our receiving wallet
        const instructions = tx.transaction.message.instructions;
        const innerInstructions = tx.meta?.innerInstructions ?? [];

        const allInstructions = [
          ...instructions,
          ...innerInstructions.flatMap((ii) => ii.instructions),
        ];

        let usdFound = 0;
        for (const ix of allInstructions) {
          if (!('parsed' in ix)) continue;
          const p = (ix as any).parsed;
          if (
            p?.type === 'transferChecked' &&
            p?.info?.mint === USDC_MINT &&
            p?.info?.destination &&
            p?.info?.source &&
            p?.info?.tokenAmount?.uiAmount
          ) {
            // Verify destination is owned by receiving wallet, source is NOT (prevent self-transfer double-counting)
            try {
              const destPubkey = new PublicKey(p.info.destination);
              const destInfo = await connection.getParsedAccountInfo(destPubkey);
              const destOwner = (destInfo.value?.data as any)?.parsed?.info?.owner;

              const srcPubkey = new PublicKey(p.info.source);
              const srcInfo = await connection.getParsedAccountInfo(srcPubkey);
              const srcOwner = (srcInfo.value?.data as any)?.parsed?.info?.owner;

              if (destOwner === RECEIVING_WALLET && srcOwner !== RECEIVING_WALLET) {
                usdFound += p.info.tokenAmount.uiAmount;
              }
            } catch {
              // skip unresolvable accounts
            }
          }
        }
        return { usdFound } as const;
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SOLANA_VERIFICATION_TIMEOUT')), 15_000)),
    ]);

    if ('earlyReturn' in verificationResult) {
      releaseClaimSolanaSignature(signature);
      return verificationResult.earlyReturn;
    }
    transferredUsd = verificationResult.usdFound;
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'SOLANA_VERIFICATION_TIMEOUT';
    logger.error({ err, signature, timeout: isTimeout }, 'Solana tx verification failed');
    releaseClaimSolanaSignature(signature);
    if (isTimeout) {
      return c.json({ error: 'Transaction verification timed out. Please try again.', code: 'VERIFICATION_TIMEOUT' }, 504);
    }
    return c.json({ error: 'Failed to verify transaction. Please try again.', code: 'VERIFICATION_FAILED' }, 500);
  }

  // 6. Validate amount matches expected package (allow 0.1% tolerance for rounding)
  const tolerance = expectedUsd * 0.001;
  if (transferredUsd < expectedUsd - tolerance) {
    releaseClaimSolanaSignature(signature);
    return c.json({
      error: `Payment amount mismatch. Expected $${expectedUsd} USDC, found $${transferredUsd.toFixed(2)} USDC going to receiving wallet.`,
      code: 'AMOUNT_MISMATCH',
    }, 400);
  }

  // 7. Signature already claimed atomically above — skip redundant mark.

  // 8. Assign credits to Clerk user — wrapped in DB transaction so a crash
  //    between the idempotency claim (step 4) and the credit grant cannot leave
  //    the user paid-but-uncredited. The tryClaimSolanaSignature INSERT is the
  //    single source of truth; the credit grant is atomic with it here.
  const emailToUse = clerkEmail || replyEmail || '';

  const { apiKey, totalCredits } = getDb().transaction(() => {
    const existingKey = getApiKeyByClerkId(clerkUserId);
    if (existingKey) {
      topUpCreditsForClerk(clerkUserId, credits, signature, expectedUsd);
      logger.info({ clerkUserId, addedCredits: credits, signature }, 'USDC: credits topped up');
      return { apiKey: existingKey.key, totalCredits: (existingKey.credits ?? 0) + credits };
    }
    const newKey = 'cn-' + crypto.randomBytes(24).toString('hex');
    createApiKeyForClerk({ key: newKey, clerkUserId, email: emailToUse, credits, solanaSignature: signature, amountPaid: expectedUsd });
    logger.info({ clerkUserId, credits, amountPaid: expectedUsd, signature }, 'USDC: new key created');
    return { apiKey: newKey, totalCredits: credits };
  })();

  // 9. Send confirmation email fire-and-forget — credits are already assigned
  if (emailToUse) {
    sendApiKeyEmail({ to: emailToUse, apiKey, credits: totalCredits, amountPaid: expectedUsd })
      .catch((err) => logger.error({ err, clerkUserId }, 'USDC: confirmation email failed — credits were assigned'));
  }

  // Soma Receipt — cryptographic proof of purchase (fire-and-forget)
  const receiptPromise = createSomaReceipt({
    requestId: `solana-${signature}`,
    apiKey,
    paymentMethod: 'solana',
    paymentRef: signature,
    creditsCost: credits,
    requestData: JSON.stringify({ clerkUserId, expectedUsd, signature }),
    responseData: JSON.stringify({ credits, totalCredits }),
  }).catch((err) => logger.error({ err }, 'Soma receipt failed for Solana purchase'));

  // Never return the full API key in the response body — it was already emailed
  const maskedKey = maskApiKey(apiKey);

  // Try to include receipt in response (non-blocking — falls back gracefully)
  let receiptId: string | undefined;
  let easScanUrl: string | undefined;
  try {
    const receipt = await Promise.race([receiptPromise, new Promise(r => setTimeout(r, 2000))]) as any;
    if (receipt?.id) {
      receiptId = receipt.id;
      easScanUrl = receipt.easScanUrl ?? undefined;
    }
  } catch { /* non-critical */ }

  return c.json({
    ok: true,
    credits,
    totalCredits,
    maskedApiKey: maskedKey,
    message: `${credits.toLocaleString()} credits added. Your API key has been sent to your email.`,
    ...(receiptId && { receipt: { id: receiptId, verifyUrl: `/v1/soma/receipt/${receiptId}`, easScanUrl } }),
  });
});

// GET /v1/solana/packages — returns available USDC packages (auth-gated to hide receiving wallet)
solanaRouter.get('/packages', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, 401);
  }
  const clerkKey = env.CLERK_SECRET_KEY;
  if (!clerkKey) return c.json({ error: 'Clerk not configured', code: 'CLERK_NOT_CONFIGURED' }, 500);
  try {
    await verifyToken(authHeader.slice(7), { secretKey: clerkKey });
  } catch {
    return c.json({ error: 'Invalid or expired session.', code: 'INVALID_SESSION' }, 401);
  }
  return c.json({
    receivingWallet: RECEIVING_WALLET,
    usdcMint: USDC_MINT,
    packages: Object.entries(USDC_PACKAGES).map(([usd, credits]) => ({
      usd: Number(usd),
      credits,
      bonusVsStripe: Number(usd) >= 20 ? '+7%' : null,
    })),
  });
});

const BuildTxSchema = z.object({
  amountUsd: z.number().int().positive(),
  senderWallet: z.string().min(32).max(44),
});

// POST /v1/solana/build-tx — builds an unsigned USDC transfer transaction for Phantom to sign
solanaRouter.post('/build-tx', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, 401);
  }
  const clerkKey2 = env.CLERK_SECRET_KEY;
  if (!clerkKey2) return c.json({ error: 'Clerk not configured', code: 'CLERK_NOT_CONFIGURED' }, 500);
  try {
    await verifyToken(authHeader.slice(7), { secretKey: clerkKey2 });
  } catch {
    return c.json({ error: 'Invalid or expired session.', code: 'INVALID_SESSION' }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, 400);
  }

  const parsed = BuildTxSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'INVALID_REQUEST', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { amountUsd, senderWallet } = parsed.data;

  if (!USDC_PACKAGES[amountUsd]) {
    return c.json({ error: `Invalid amount. Valid amounts: ${Object.keys(USDC_PACKAGES).join(', ')} USD`, code: 'INVALID_AMOUNT' }, 400);
  }

  if (!RECEIVING_WALLET) {
    return c.json({ error: 'Solana payments not currently configured.', code: 'SOLANA_NOT_CONFIGURED' }, 503);
  }

  try {
    const { getAssociatedTokenAddress, createTransferCheckedInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const { Transaction } = await import('@solana/web3.js');

    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl, 'confirmed');

    const senderPubkey = new PublicKey(senderWallet);
    const receiverPubkey = new PublicKey(RECEIVING_WALLET);
    const usdcMint = new PublicKey(USDC_MINT);

    const senderAta = await getAssociatedTokenAddress(usdcMint, senderPubkey);
    const receiverAta = await getAssociatedTokenAddress(usdcMint, receiverPubkey);

    const usdcAmount = BigInt(amountUsd * 1_000_000); // USDC has 6 decimals

    const transferIx = createTransferCheckedInstruction(
      senderAta,
      usdcMint,
      receiverAta,
      senderPubkey,
      usdcAmount,
      6,
      [],
      TOKEN_PROGRAM_ID,
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: senderPubkey });
    tx.add(transferIx);

    const serialized = tx.serialize({ requireAllSignatures: false });
    const serializedTx = Buffer.from(serialized).toString('base64');

    logger.info({ amountUsd, senderWallet: senderWallet.slice(0, 8) + '...' }, 'USDC build-tx prepared');

    return c.json({ serializedTx });
  } catch (err) {
    logger.error({ err }, 'Failed to build USDC transaction');
    return c.json({ error: 'Failed to build transaction. Please try again.', code: 'BUILD_TX_FAILED' }, 500);
  }
});