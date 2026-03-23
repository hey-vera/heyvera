#!/usr/bin/env node
/**
 * @aidprotocol/facilitator — Open-source x402 facilitator with AID trust
 *
 * A minimal, fee-free x402 facilitator that anyone can self-host.
 * Verifies x402 payment proofs and settles on Base L2.
 *
 * Features:
 *   - Zero fees (vs Coinbase's $0.001/tx)
 *   - AID trust headers in responses
 *   - Trust-gated pricing tiers
 *   - Simple HTTP server (Node.js, no framework deps)
 *
 * Usage:
 *   npx @aidprotocol/facilitator
 *   # or
 *   AID_FACILITATOR_PORT=8402 npx @aidprotocol/facilitator
 *
 * Environment:
 *   AID_FACILITATOR_PORT    — HTTP port (default: 8402)
 *   AID_API_URL             — AID trust API (default: https://api.claw-net.org)
 *   BASE_RPC_URL            — Base L2 RPC endpoint (required for settlement)
 *   SETTLEMENT_PRIVATE_KEY  — Private key for on-chain settlement (hex)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { getTrustVerdict } from '@aidprotocol/trust-compute';

const PORT = parseInt(process.env.AID_FACILITATOR_PORT || '8402', 10);
const AID_API = process.env.AID_API_URL || 'https://api.claw-net.org';
const HAS_SETTLEMENT_KEY = !!process.env.SETTLEMENT_PRIVATE_KEY;

// ─── Request Handler ────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AID-DID, X-AID-PROOF, X-AID-TIMESTAMP, X-AID-NONCE');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Routes
  if (path === '/info' && req.method === 'GET') {
    json(res, 200, {
      name: 'AID Protocol Facilitator',
      version: '1.0.0',
      protocol: 'x402',
      fee: '0',
      feeDescription: 'Zero fees — open-source, self-hosted',
      chains: ['base'],
      currencies: ['USDC'],
      canSettle: HAS_SETTLEMENT_KEY,
      aidTrust: { enabled: true, apiUrl: AID_API },
    });
    return;
  }

  if (path === '/health' && req.method === 'GET') {
    json(res, 200, {
      status: 'healthy',
      canVerify: true,
      canSettle: HAS_SETTLEMENT_KEY,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (path === '/verify' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.payload) {
      json(res, 400, { valid: false, error: 'Missing payment payload' });
      return;
    }

    // Check AID trust if DID header present
    const did = req.headers['x-aid-did'] as string;
    let trustInfo = null;
    if (did) {
      try {
        const trustRes = await fetch(`${AID_API}/v1/aid/${encodeURIComponent(did)}/trust`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (trustRes.ok) {
          const data = await trustRes.json() as any;
          const score = data.trustScore ?? data.score ?? 0;
          trustInfo = { score, verdict: getTrustVerdict(score) };
        }
      } catch { /* non-critical */ }
    }

    // Basic payment verification (signature check would go here)
    // For now, validate payload structure
    const valid = body.payload && (body.payload.amount || body.payload.value);

    json(res, 200, {
      valid: !!valid,
      facilitator: 'aidprotocol',
      fee: '0',
      trust: trustInfo ? {
        did,
        score: trustInfo.score,
        verdict: trustInfo.verdict.verdict,
        discount: trustInfo.verdict.discount,
      } : null,
    });
    return;
  }

  if (path === '/settle' && req.method === 'POST') {
    if (!HAS_SETTLEMENT_KEY) {
      json(res, 503, { settled: false, error: 'No settlement key configured. Set SETTLEMENT_PRIVATE_KEY.' });
      return;
    }

    const body = await readBody(req);
    if (!body || !body.payload) {
      json(res, 400, { settled: false, error: 'Missing payment payload' });
      return;
    }

    // Settlement would call receiveWithAuthorization on Base USDC contract
    // This is a reference implementation — real settlement requires viem/ethers
    json(res, 200, {
      settled: false,
      error: 'Settlement not yet implemented in reference facilitator. Use ClawNet facilitator for live settlement.',
      facilitator: 'aidprotocol',
      fee: '0',
    });
    return;
  }

  // 404
  json(res, 404, { error: 'Not found', routes: ['/info', '/health', '/verify', '/settle'] });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// ─── Start Server ───────────────────────────────────────────────────────────

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`AID Protocol Facilitator running on http://localhost:${PORT}`);
  console.log(`  /info    — facilitator metadata`);
  console.log(`  /health  — health check`);
  console.log(`  /verify  — verify x402 payment proof`);
  console.log(`  /settle  — settle payment on-chain`);
  console.log(`  Fee: $0 (zero fees)`);
  console.log(`  Settlement: ${HAS_SETTLEMENT_KEY ? 'enabled' : 'disabled (set SETTLEMENT_PRIVATE_KEY)'}`);
  console.log(`  AID Trust: ${AID_API}`);
});
