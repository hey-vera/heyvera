import type { MiddlewareHandler } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { getDb } from '../db/index';
import { getRotationBackend } from '../core/rotation-backend';

/**
 * G7.3 — read-only rotation shadow-check.
 *
 * Runs only when ROTATION_SHADOW_CHECK_ENABLED is set. Must be wired
 * after checkApiKey so it only sees requests the legacy path accepted.
 * Never mutates rotation state. Never blocks the request on error.
 */
export const rotationShadowCheck: MiddlewareHandler = async (c, next) => {
  if (!env.ROTATION_SHADOW_CHECK_ENABLED) {
    await next();
    return;
  }

  const bearer = c.req.header('X-API-Key');

  if (bearer) {
    try {
      // Env-key skip: mirrors checkApiKey's exact split/trim/filter.
      // Env keys are never in the rotation backend; a lookup would always
      // produce a misleading notAdopted metric.
      const envKeys = (env.API_KEYS ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (envKeys.includes(bearer)) {
        logger.info({ shadowCheck: 'skipped' });
        await next();
        return;
      }

      // Delegated-key skip: primary-key point read on delegated_keys.
      // PR review open question: DB lookup vs key-format sniff — format
      // sniff is faster (~0 ms) but brittle if the prefix ever changes;
      // the DB lookup is ~0.1 ms and schema-stable.
      const isDelegated = getDb()
        .prepare('SELECT 1 FROM delegated_keys WHERE key = ? LIMIT 1')
        .get(bearer);
      if (isDelegated) {
        logger.info({ shadowCheck: 'skipped' });
        await next();
        return;
      }

      // Shadow check: consult rotation backend alongside the legacy decision.
      // lookupByBearer returns null for unknown, revoked, or expired credentials.
      const result = getRotationBackend().lookupByBearer(bearer, Date.now());
      logger.info({ shadowCheck: result !== null ? 'match' : 'notAdopted' });
    } catch {
      // Never block the request on a shadow-check failure.
      logger.info({ shadowCheck: 'error' });
    }
  }

  await next();
};
