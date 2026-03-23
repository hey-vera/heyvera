/**
 * @aidprotocol/middleware/fastify — AID trust plugin for Fastify
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { aidTrustPlugin } from '@aidprotocol/middleware/fastify';
 *
 * const app = Fastify();
 * app.register(aidTrustPlugin, { minTrustScore: 40 });
 *
 * app.get('/data', (req, reply) => {
 *   if (req.aidInfo) {
 *     console.log(req.aidInfo.trustScore); // 87
 *     console.log(req.aidInfo.verdict);    // 'trusted'
 *   }
 *   reply.send({ ok: true });
 * });
 * ```
 */

import { verifyAidRequest, clearAidCache } from './index';
import type { AidMiddlewareConfig, AidInfo } from './index';

export type { AidMiddlewareConfig, AidInfo };
export { clearAidCache };

// Extend Fastify Request type
declare module 'fastify' {
  interface FastifyRequest {
    aidInfo?: AidInfo;
  }
}

/**
 * Fastify plugin that verifies AID trust headers on every request.
 *
 * Register with `app.register(aidTrustPlugin, { minTrustScore: 40 })`.
 * Sets `request.aidInfo` when X-AID-DID headers are present and valid.
 */
export async function aidTrustPlugin(fastify: any, opts: AidMiddlewareConfig = {}) {
  // Decorate request with aidInfo
  fastify.decorateRequest('aidInfo', null);

  // Add content type parser to get raw body when needed
  // Fastify parses body automatically — we reconstruct from parsed body
  fastify.addHook('preHandler', async (request: any, reply: any) => {
    // Build body buffer
    let bodyBytes: Buffer;
    if (Buffer.isBuffer(request.body)) {
      bodyBytes = request.body;
    } else if (typeof request.body === 'string') {
      bodyBytes = Buffer.from(request.body);
    } else if (request.body && typeof request.body === 'object') {
      bodyBytes = Buffer.from(JSON.stringify(request.body));
    } else {
      bodyBytes = Buffer.alloc(0);
    }

    const url = new URL(request.url, `http://${request.hostname || 'localhost'}`);

    const result = await verifyAidRequest(
      (name: string) => {
        const val = request.headers[name.toLowerCase()];
        return Array.isArray(val) ? val[0] : val;
      },
      request.method,
      url.pathname,
      bodyBytes,
      opts,
    );

    if (result.ok) {
      request.aidInfo = result.aidInfo;
      return;
    }

    // AID headers not present — pass through
    if (result.code === 'AID_NOT_PRESENT') {
      return;
    }

    // Verification failed
    reply.code(result.status).send({
      error: result.error,
      code: result.code,
    });
  });
}
