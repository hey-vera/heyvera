/**
 * encoding.ts — Shared encoding validation and conversion utilities.
 *
 * Centralizes hex/base64 validation to prevent silent garbled-byte issues
 * when Buffer.from() is called with invalid input (audit H2).
 */

const HEX_RE = /^[0-9a-f]+$/i;

/** Returns true if the string is valid hex (even length, 0-9a-f). */
export function isValidHex(s: string): boolean {
  return s.length > 0 && s.length % 2 === 0 && HEX_RE.test(s);
}

/** Throws if the string is not valid hex. Use at system boundaries. */
export function assertHex(s: string, label: string): void {
  if (!isValidHex(s)) {
    throw new Error(`${label}: invalid hex encoding (got ${s.length} chars)`);
  }
}

/** Safe hex decode — returns null instead of garbled bytes on invalid input. */
export function hexToBuffer(s: string): Buffer | null {
  if (!isValidHex(s)) return null;
  return Buffer.from(s, 'hex');
}
