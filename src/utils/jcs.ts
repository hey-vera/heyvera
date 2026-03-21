/**
 * Shared JCS (RFC 8785) canonicalization and Base58btc encoding/decoding.
 * Single source of truth — used by aid-builder, aid-verifier, and ed25519-signer.
 */

export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * JSON Canonicalization Scheme (RFC 8785): deterministic JSON serialization.
 * - Object keys sorted lexicographically (Unicode code point order)
 * - No whitespace
 * - Numbers serialized per ES2015 Number.toString()
 * - undefined values omitted (matches JSON.stringify)
 */
export function jcsSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('JCS: non-finite numbers not supported');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(jcsSerialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort();
    const entries = keys.map(k => JSON.stringify(k) + ':' + jcsSerialize(obj[k]));
    return '{' + entries.join(',') + '}';
  }
  return '';
}

export function jcsCanonicalizeToBytes(obj: Record<string, unknown>): Buffer {
  return Buffer.from(jcsSerialize(obj), 'utf8');
}

export function base58btcEncode(buf: Buffer): string {
  let num = BigInt('0x' + buf.toString('hex'));
  let encoded = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  for (const byte of buf) {
    if (byte === 0) encoded = '1' + encoded;
    else break;
  }
  return encoded;
}

export function base58btcDecode(str: string): Buffer {
  let num = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(2, '0');
  const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '1') leadingZeros++;
    else break;
  }
  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}

/**
 * Validate a multibase-encoded Ed25519 public key.
 * Must start with 'z' (base58btc), decode to 0xed 0x01 prefix + 32-byte key.
 */
export function validateMultibaseEd25519(publicKeyMultibase: string): { valid: boolean; error?: string } {
  if (!publicKeyMultibase.startsWith('z')) {
    return { valid: false, error: 'Multibase must start with z (base58btc)' };
  }
  try {
    const decoded = base58btcDecode(publicKeyMultibase.slice(1));
    if (decoded.length !== 34) {
      return { valid: false, error: `Expected 34 bytes (2 prefix + 32 key), got ${decoded.length}` };
    }
    if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
      return { valid: false, error: 'Invalid multikey prefix (expected 0xed 0x01 for Ed25519)' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Base58btc decode failed: ${(err as Error).message}` };
  }
}
