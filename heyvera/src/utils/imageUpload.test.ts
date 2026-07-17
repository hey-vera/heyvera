import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageFile } from './imageUpload';

function makeFile(type: string, size: number, name = 'photo.bin'): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('validateImageFile', () => {
  it('accepts common image MIME types under the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(validateImageFile(makeFile(type, 1024, 'ok.jpg'))).toBeNull();
    }
  });

  it('rejects unsupported MIME types', () => {
    expect(validateImageFile(makeFile('image/svg+xml', 100, 'x.svg'))).toBe(
      'Use a JPEG, PNG, GIF, or WebP image.',
    );
    expect(validateImageFile(makeFile('application/pdf', 100, 'x.pdf'))).toBe(
      'Use a JPEG, PNG, GIF, or WebP image.',
    );
  });

  it('rejects files larger than 10 MB', () => {
    expect(validateImageFile(makeFile('image/jpeg', MAX_IMAGE_BYTES + 1, 'big.jpg'))).toBe(
      'Image must be 10 MB or smaller.',
    );
  });

  it('accepts files exactly at the 10 MB limit', () => {
    expect(validateImageFile(makeFile('image/png', MAX_IMAGE_BYTES, 'edge.png'))).toBeNull();
  });
});
