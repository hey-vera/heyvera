/**
 * Soft-launch integrity — pure resolvers for VITE_API_URL.
 *
 * Production: set VITE_API_URL=https://api.heyvera.org (see .env.example).
 * Local: leave empty so relative /v1/* and /api/* hit Vite dual proxy →
 * heyvera-server :3002 (social/pulse/health) and cortex-server :3001 (billing).
 */

/** Normalize env string: trim, strip trailing slash; empty → "". */
export function normalizeApiUrlEnv(raw: string | undefined | null): string {
  if (raw == null) return '';
  return String(raw).trim().replace(/\/+$/, '');
}

/**
 * Resolve the Social API base (`…/v1/social`) from optional VITE_API_URL.
 * Empty → same-origin relative `/v1/social` (Vite proxy / Caddy apex).
 */
export function resolveSocialApiBase(viteApiUrl?: string | null): string {
  const raw = normalizeApiUrlEnv(viteApiUrl);
  if (!raw) return '/v1/social';
  if (raw.endsWith('/v1/social')) return raw;
  if (raw.endsWith('/v1')) return `${raw}/social`;
  return `${raw}/v1/social`;
}

/**
 * Resolve Pulse API base (`…/v1/pulse`) from optional VITE_API_URL.
 */
export function resolvePulseApiBase(viteApiUrl?: string | null): string {
  const raw = normalizeApiUrlEnv(viteApiUrl);
  if (!raw) return '/v1/pulse';
  if (raw.endsWith('/v1/pulse')) return raw;
  if (raw.endsWith('/v1')) return `${raw}/pulse`;
  return `${raw}/v1/pulse`;
}

/**
 * Origin (or empty for same-origin) used when building absolute paths
 * that are not under `/v1` (e.g. billing `/api/*`).
 * If VITE_API_URL ends with `/v1`, strip that suffix.
 */
export function resolveApiOrigin(viteApiUrl?: string | null): string {
  const raw = normalizeApiUrlEnv(viteApiUrl);
  if (!raw) return '';
  if (raw.endsWith('/v1')) return raw.slice(0, -3).replace(/\/+$/, '');
  return raw;
}
