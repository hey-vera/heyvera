/**
 * @aidprotocol/middleware/express — AID trust middleware for Express
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { aidTrust } from '@aidprotocol/middleware/express';
 *
 * const app = express();
 * app.use(express.json()); // body parsing middleware must run first
 * app.use(aidTrust({ minTrustScore: 40 }));
 *
 * app.get('/data', (req, res) => {
 *   if (req.aidInfo) {
 *     console.log(req.aidInfo.trustScore); // 87
 *     console.log(req.aidInfo.verdict);    // 'trusted'
 *   }
 *   res.json({ ok: true });
 * });
 * ```
 */

import { verifyAidRequest, clearAidCache } from './index';
import type { AidMiddlewareConfig, AidInfo } from './index';

export type { AidMiddlewareConfig, AidInfo };
export { clearAidCache };

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      aidInfo?: AidInfo;
    }
  }
}

/**
 * Express middleware that verifies AID trust headers.
 *
 * When X-AID-DID is present, verifies the signature, resolves trust,
 * and sets `req.aidInfo`. When absent, passes through (AID is optional).
 *
 * Requires body parsing middleware to run first (express.json(), express.raw(), etc.).
 */
export function aidTrust(config: AidMiddlewareConfig = {}) {
  return async (req: any, res: any, next: any) => {
    // Build body buffer from whatever Express parsed
    let bodyBytes: Buffer;
    if (Buffer.isBuffer(req.body)) {
      bodyBytes = req.body;
    } else if (typeof req.body === 'string') {
      bodyBytes = Buffer.from(req.body);
    } else if (req.body && typeof req.body === 'object') {
      bodyBytes = Buffer.from(JSON.stringify(req.body));
    } else {
      bodyBytes = Buffer.alloc(0);
    }

    const result = await verifyAidRequest(
      (name: string) => {
        const val = req.headers[name.toLowerCase()];
        return Array.isArray(val) ? val[0] : val;
      },
      req.method,
      req.path || req.url,
      bodyBytes,
      config,
    );

    if (result.ok) {
      req.aidInfo = result.aidInfo;
      return next();
    }

    // AID headers not present — pass through (optional)
    if (result.code === 'AID_NOT_PRESENT') {
      return next();
    }

    // Verification failed — return error
    return res.status(result.status).json({
      error: result.error,
      code: result.code,
    });
  };
}
