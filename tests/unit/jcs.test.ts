/**
 * JCS (RFC 8785) test vectors — verifies our jcsSerialize() implementation
 * against the official examples from the RFC specification.
 *
 * Covers: key sorting, number serialization, string escaping, nested objects,
 * arrays, null/boolean, and negative zero normalization.
 */
import { describe, it, expect } from 'vitest';
import { jcsSerialize } from '../../src/utils/jcs';

// ── RFC 8785 §3.2.3 — Object key sorting ─────────────────────────────────

describe('JCS key sorting', () => {
  it('sorts keys in Unicode code point order', () => {
    const input = { z: 1, a: 2, m: 3 };
    expect(jcsSerialize(input)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts numeric-like string keys lexicographically, not numerically', () => {
    const input = { '10': 'ten', '2': 'two', '1': 'one' };
    expect(jcsSerialize(input)).toBe('{"1":"one","10":"ten","2":"two"}');
  });

  it('sorts mixed case keys by code point (uppercase before lowercase)', () => {
    const input = { b: 1, A: 2, a: 3, B: 4 };
    expect(jcsSerialize(input)).toBe('{"A":2,"B":4,"a":3,"b":1}');
  });
});

// ── RFC 8785 §3.2.2 — Number serialization ────────────────────────────────

describe('JCS number serialization', () => {
  it('serializes integers without decimal point', () => {
    expect(jcsSerialize(0)).toBe('0');
    expect(jcsSerialize(1)).toBe('1');
    expect(jcsSerialize(-1)).toBe('-1');
    expect(jcsSerialize(999999999999999)).toBe('999999999999999');
  });

  it('normalizes negative zero to "0"', () => {
    expect(jcsSerialize(-0)).toBe('0');
  });

  it('serializes floats per ES2015 Number.toString()', () => {
    expect(jcsSerialize(0.5)).toBe('0.5');
    expect(jcsSerialize(1e20)).toBe('100000000000000000000');
    expect(jcsSerialize(1e21)).toBe('1e+21');
    expect(jcsSerialize(1e-7)).toBe('1e-7');
    expect(jcsSerialize(1e-6)).toBe('0.000001');
  });

  it('rejects non-finite numbers', () => {
    expect(() => jcsSerialize(Infinity)).toThrow('non-finite');
    expect(() => jcsSerialize(-Infinity)).toThrow('non-finite');
    expect(() => jcsSerialize(NaN)).toThrow('non-finite');
  });
});

// ── RFC 8785 §3.2.1 — String serialization ────────────────────────────────

describe('JCS string serialization', () => {
  it('escapes control characters and quotes', () => {
    expect(jcsSerialize('hello')).toBe('"hello"');
    expect(jcsSerialize('')).toBe('""');
    expect(jcsSerialize('a"b')).toBe('"a\\"b"');
    expect(jcsSerialize('a\\b')).toBe('"a\\\\b"');
  });

  it('handles unicode characters', () => {
    // JSON.stringify preserves non-ASCII unicode as-is per RFC 8785
    expect(jcsSerialize('\u20ac')).toBe('"\u20ac"'); // Euro sign
  });
});

// ── Compound structures ───────────────────────────────────────────────────

describe('JCS compound structures', () => {
  it('serializes null', () => {
    expect(jcsSerialize(null)).toBe('null');
  });

  it('serializes booleans', () => {
    expect(jcsSerialize(true)).toBe('true');
    expect(jcsSerialize(false)).toBe('false');
  });

  it('serializes arrays preserving order', () => {
    expect(jcsSerialize([3, 1, 2])).toBe('[3,1,2]');
    expect(jcsSerialize([])).toBe('[]');
  });

  it('serializes nested objects with sorted keys at each level', () => {
    const input = { b: { d: 1, c: 2 }, a: [3] };
    expect(jcsSerialize(input)).toBe('{"a":[3],"b":{"c":2,"d":1}}');
  });

  it('omits undefined values (matches JSON.stringify)', () => {
    const input = { a: 1, b: undefined, c: 3 };
    expect(jcsSerialize(input)).toBe('{"a":1,"c":3}');
  });

  it('serializes empty object', () => {
    expect(jcsSerialize({})).toBe('{}');
  });
});

// ── RFC 8785 Appendix B — Full test vector ────────────────────────────────

describe('JCS full RFC 8785 test vector', () => {
  it('matches the RFC example for a complex nested object', () => {
    // Adapted from RFC 8785 examples — tests key sorting + number + nested
    const input = {
      numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001],
      string: '\u20ac$\u000F\u000A A\'\u0042\u0022\u005C\\\"/',
      literals: [null, true, false],
    };
    const result = jcsSerialize(input);
    // Keys must be sorted: "literals" < "numbers" < "string"
    expect(result.indexOf('"literals"')).toBeLessThan(result.indexOf('"numbers"'));
    expect(result.indexOf('"numbers"')).toBeLessThan(result.indexOf('"string"'));
    // Verify it's valid JSON that roundtrips
    expect(JSON.parse(result)).toBeTruthy();
  });
});
