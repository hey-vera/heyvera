import { describe, expect, it } from 'vitest';
import {
  normalizeApiUrlEnv,
  resolveApiOrigin,
  resolvePulseApiBase,
  resolveSocialApiBase,
} from './apiOrigin';

describe('normalizeApiUrlEnv', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeApiUrlEnv('  https://api.heyvera.org/  ')).toBe('https://api.heyvera.org');
    expect(normalizeApiUrlEnv(null)).toBe('');
    expect(normalizeApiUrlEnv(undefined)).toBe('');
    expect(normalizeApiUrlEnv('   ')).toBe('');
  });
});

describe('resolveSocialApiBase', () => {
  it('defaults to same-origin relative path when empty', () => {
    expect(resolveSocialApiBase('')).toBe('/v1/social');
    expect(resolveSocialApiBase(undefined)).toBe('/v1/social');
  });

  it('appends /v1/social to bare origin', () => {
    expect(resolveSocialApiBase('https://api.heyvera.org')).toBe(
      'https://api.heyvera.org/v1/social',
    );
  });

  it('handles /v1 suffix and already-social base', () => {
    expect(resolveSocialApiBase('https://api.heyvera.org/v1')).toBe(
      'https://api.heyvera.org/v1/social',
    );
    expect(resolveSocialApiBase('https://api.heyvera.org/v1/social')).toBe(
      'https://api.heyvera.org/v1/social',
    );
    expect(resolveSocialApiBase('/v1')).toBe('/v1/social');
  });
});

describe('resolvePulseApiBase', () => {
  it('defaults to /v1/pulse and appends correctly', () => {
    expect(resolvePulseApiBase('')).toBe('/v1/pulse');
    expect(resolvePulseApiBase('https://api.heyvera.org')).toBe(
      'https://api.heyvera.org/v1/pulse',
    );
    expect(resolvePulseApiBase('https://api.heyvera.org/v1')).toBe(
      'https://api.heyvera.org/v1/pulse',
    );
  });
});

describe('resolveApiOrigin', () => {
  it('returns empty for same-origin; strips trailing /v1', () => {
    expect(resolveApiOrigin('')).toBe('');
    expect(resolveApiOrigin('https://api.heyvera.org')).toBe('https://api.heyvera.org');
    expect(resolveApiOrigin('https://api.heyvera.org/v1')).toBe('https://api.heyvera.org');
  });
});
