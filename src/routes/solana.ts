// src/routes/solana.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyToken } from '@clerk/backend';
import { logger } from '../utils/logger';
import { getApiKeyByClerkId, createApiKeyForClerk, topUpCreditsForClerk, isSignatureProcessed, markSignatureProcessed } from '../db/index';
import { sendApiKeyEmail } from '../utils/email';
import { env } from '../config/index';
import crypto from 'crypto';

export const solanaRouter = new Hono();

// USDC mint on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Receiving wallet — sourced from validated env config
const RECEIVING_WALLET = env.SOLANA_RECEIVING_WALLET ?? '';

// Credit amounts — exactly +10% over equivalent Stripe package at every tier
// Stripe: $20→21K, $50→54K, $100→112K, $500→600K, $1000→1.3M
// USDC:   $20→23K, $50→59K, $100→123K, $500→660K, $1000→1.43M (+10% consistently)
const USDC_PACKAGES: Record<number, number> = {
  20:   23_000,
  50:   59_000,
  100:  123_000,
  500:  660_000,
  1000: 1_430_000,
};

const VerifySchema = z.object({
  signature: z.string().min(80).max(120).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid base58 signature'),
  expectedUsd: z.number().int().positive(),
  replyEmail: z.string().email().optional(),
});

// Processed signatures are persisted to SQLite — survives restarts

// POST /v1/solana/verify
solanaRouter.post('/verify', async (c) => {
  // 1. Require Clerk JWT
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required. Please sign in.' }, 401);
  }

  const token = authHeader.slice(7);
  let clerkUserId: string;
  let clerkEmail: string;

  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY ?? '',
    });
    clerkUserId = payload.sub;
    clerkEmail = ((payload as any).email ?? '').toLowerCase();
  } catch {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  // 2. Parse body
  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { signature, expectedUsd, replyEmail } = parsed.data;

  // 3. Check package is valid
  const credits = USDC_PACKAGES[expectedUsd];
  if (!credits) {
    return c.json({ error: `Invalid package amount. Valid amounts: ${Object.keys(USDC_PACKAGES).join(', ')}` }, 400);
  }

  // 4. Idempotency — reject duplicate signatures
  if (isSignatureProcessed(signature)) {
    return c.json({ error: 'Transaction already processed.' }, 409);
  }

  // 5. Verify transaction on-chain
  const rpcUrl = env.SOLANA_RPC_URL;
  const connection = new Connection(rpcUrl, 'confirmed');

  let transferredUsd = 0;

  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      return c.json({ error: 'Transaction not found. It may still be confirming — wait a few seconds and try again.' }, 404);
    }

    if (tx.meta?.err) {
      return c.json({ error: 'Transaction failed on-chain.' }, 400);
    }

    // Walk through token transfers to find USDC to our receiving wallet
    const instructions = tx.transaction.message.instructions;
    const innerInstructions = tx.meta?.innerInstructions ?? [];

    const allInstructions = [
      ...instructions,
      ...innerInstructions.flatMap((ii) => ii.instructions),
    ];

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
            transferredUsd += p.info.tokenAmount.uiAmount;
          }
        } catch {
          // skip unresolvable accounts
        }
      }
    }
  } catch (err) {
    logger.error({ err, signature }, 'Solana tx verification failed');
    return c.json({ error: 'Failed to verify transaction. Please try again.' }, 500);
  }

  // 6. Validate amount matches expected package (allow 0.1% tolerance for rounding)
  const tolerance = expectedUsd * 0.001;
  if (transferredUsd < expectedUsd - tolerance) {
    return c.json({
      error: `Payment amount mismatch. Expected $${expectedUsd} USDC, found $${transferredUsd.toFixed(2)} USDC going to receiving wallet.`,
    }, 400);
  }

  // 7. Mark signature as processed
  markSignatureProcessed(signature);

  // 8. Assign credits to Clerk user
  const emailToUse = clerkEmail || replyEmail || '';
  const existingKey = getApiKeyByClerkId(clerkUserId);

  let apiKey: string;
  let totalCredits: number;

  if (existingKey) {
    apiKey = existingKey.key;
    topUpCreditsForClerk(clerkUserId, credits, signature);
    totalCredits = (existingKey.credits ?? 0) + credits;
    logger.info({ clerkUserId, addedCredits: credits, totalCredits, signature }, 'USDC: credits topped up');
  } else {
    // Create new key linked to Clerk ID
    apiKey = 'cn-' + crypto.randomBytes(24).toString('hex');
    createApiKeyForClerk({
      key: apiKey,
      clerkUserId,
      email: emailToUse,
      credits,
      solanaSignature: signature,
      amountPaid: expectedUsd,
    });
    totalCredits = credits;
    logger.info({ clerkUserId, credits, amountPaid: expectedUsd, signature }, 'USDC: new key created');
  }

  // 9. Send confirmation email if we have one
  if (emailToUse) {
    try {
      await sendApiKeyEmail({
        to: emailToUse,
        apiKey,
        credits: totalCredits,
        amountPaid: expectedUsd,
      });
    } catch (err) {
      logger.error({ err, clerkUserId }, 'USDC: confirmation email failed — credits were assigned');
    }
  }

  // Never return the full API key in the response body — it was already emailed
  const maskedKey = apiKey.slice(0, 6) + '••••••••••••••••••••••••••••••••••••••••' + apiKey.slice(-4);
  return c.json({
    ok: true,
    credits,
    totalCredits,
    maskedApiKey: maskedKey,
    message: `${credits.toLocaleString()} credits added. Your API key has been sent to your email.`,
  });
});

// GET /v1/solana/packages — returns available USDC packages (auth-gated to hide receiving wallet)
solanaRouter.get('/packages', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.' }, 401);
  }
  try {
    await verifyToken(authHeader.slice(7), { secretKey: process.env.CLERK_SECRET_KEY! });
  } catch {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }
  return c.json({
    receivingWallet: RECEIVING_WALLET,
    usdcMint: USDC_MINT,
    packages: Object.entries(USDC_PACKAGES).map(([usd, credits]) => ({
      usd: Number(usd),
      credits,
      bonusVsStripe: Number(usd) >= 20 ? '+10%' : null,
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
    return c.json({ error: 'Authentication required.' }, 401);
  }
  try {
    await verifyToken(authHeader.slice(7), { secretKey: process.env.CLERK_SECRET_KEY! });
  } catch {
    return c.json({ error: 'Invalid or expired session.' }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const parsed = BuildTxSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { amountUsd, senderWallet } = parsed.data;

  if (!USDC_PACKAGES[amountUsd]) {
    return c.json({ error: `Invalid amount. Valid amounts: ${Object.keys(USDC_PACKAGES).join(', ')} USD` }, 400);
  }

  if (!RECEIVING_WALLET) {
    return c.json({ error: 'Solana payments not currently configured.' }, 503);
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
    return c.json({ error: 'Failed to build transaction. Please try again.' }, 500);
  }
});