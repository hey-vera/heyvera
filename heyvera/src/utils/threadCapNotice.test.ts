import { describe, expect, it } from 'vitest';
import { shouldShowThreadCapNotice } from './threadCapNotice';

describe('shouldShowThreadCapNotice', () => {
  it('shows only when repliesTruncated is true', () => {
    expect(shouldShowThreadCapNotice(true)).toBe(true);
  });

  it('hides when false', () => {
    expect(shouldShowThreadCapNotice(false)).toBe(false);
  });

  it('hides when missing (older servers)', () => {
    expect(shouldShowThreadCapNotice(undefined)).toBe(false);
  });
});
