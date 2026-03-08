// src/routes/solana.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { verifyToken } from '@clerk/backend';
import { logger } from '../utils/logger';
import { getApiKeyByClerkId, createApiKeyForClerk, topUpCreditsForClerk } from '../db/index';
import { sendApiKeyEmail } from '../utils/email';

export const solanaRouter = new Hono();

// USDC mint on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Receiving wallet
const RECEIVING_WALLET = process.env.SOLANA_RECEIVING_WALLET!;

// Credit amounts — +10% bonus vs Stripe on $20+
const USDC_PACKAGES: Record<number, number> = {
  20:   22_000,
  50:   55_000,
  100:  110_000,
  500:  605_000,
  1000: 1_320_000,
};

const VerifySchema = z.object({
  signature: z.string().min(80).max(120),
  expectedUsd: z.number().int().positive(),
  replyEmail: z.string().email().optional(),
});

// In-memory processed signatures — prevent double-spend
const processedSignatures = new Set<string>();

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
      secretKey: process.env.CLERK_SECRET_KEY!,
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
  if (processedSignatures.has(signature)) {
    return c.json({ error: 'Transaction already processed.' }, 409);
  }

  // 5. Verify transaction on-chain
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
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
        p?.info?.tokenAmount?.uiAmount
      ) {
        // Verify the destination is an ATA owned by our receiving wallet
        try {
          const destPubkey = new PublicKey(p.info.destination);
          const accountInfo = await connection.getParsedAccountInfo(destPubkey);
          const owner = (accountInfo.value?.data as any)?.parsed?.info?.owner;
          if (owner === RECEIVING_WALLET) {
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

  // 6. Validate amount matches expected package (allow 0.5% tolerance for rounding)
  const tolerance = expectedUsd * 0.005;
  if (transferredUsd < expectedUsd - tolerance) {
    return c.json({
      error: `Payment amount mismatch. Expected $${expectedUsd} USDC, found $${transferredUsd.toFixed(2)} USDC going to receiving wallet.`,
    }, 400);
  }

  // 7. Mark signature as processed
  processedSignatures.add(signature);

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
    apiKey = 'cn-' + Buffer.from(require('crypto').randomBytes(24)).toString('hex');
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

  return c.json({
    ok: true,
    credits,
    totalCredits,
    apiKey,
    message: `${credits.toLocaleString()} credits added to your account.`,
  });
});

// GET /v1/solana/packages — returns available USDC packages
solanaRouter.get('/packages', (c) => {
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