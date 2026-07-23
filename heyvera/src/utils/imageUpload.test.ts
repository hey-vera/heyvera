import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COMPOSE_MEDIA_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  isImageFile,
  isVideoFile,
  validateComposeMediaFile,
  validateImageFile,
  validateVideoFile,
} from './imageUpload';

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

describe('validateVideoFile (14f progressive)', () => {
  it('accepts mp4 and webm under the size limit', () => {
    expect(validateVideoFile(makeFile('video/mp4', 1024, 'clip.mp4'))).toBeNull();
    expect(validateVideoFile(makeFile('video/webm', 1024, 'clip.webm'))).toBeNull();
  });

  it('rejects unsupported video MIME types', () => {
    expect(validateVideoFile(makeFile('video/quicktime', 100, 'x.mov'))).toBe(
      'Use an MP4 or WebM video.',
    );
    expect(validateVideoFile(makeFile('video/x-matroska', 100, 'x.mkv'))).toBe(
      'Use an MP4 or WebM video.',
    );
  });

  it('rejects files larger than 50 MB', () => {
    expect(validateVideoFile(makeFile('video/mp4', MAX_VIDEO_BYTES + 1, 'big.mp4'))).toBe(
      'Video must be 50 MB or smaller.',
    );
  });

  it('accepts files exactly at the 50 MB limit', () => {
    expect(validateVideoFile(makeFile('video/webm', MAX_VIDEO_BYTES, 'edge.webm'))).toBeNull();
  });
});

describe('validateComposeMediaFile', () => {
  it('accepts image or progressive video', () => {
    expect(validateComposeMediaFile(makeFile('image/jpeg', 100, 'a.jpg'))).toBeNull();
    expect(validateComposeMediaFile(makeFile('video/mp4', 100, 'a.mp4'))).toBeNull();
  });

  it('rejects other types with combined message', () => {
    expect(validateComposeMediaFile(makeFile('application/pdf', 100, 'a.pdf'))).toBe(
      'Use a JPEG, PNG, GIF, WebP image or an MP4/WebM video.',
    );
  });

  it('enforces image vs video size limits', () => {
    expect(validateComposeMediaFile(makeFile('image/png', MAX_IMAGE_BYTES + 1, 'big.png'))).toBe(
      'Image must be 10 MB or smaller.',
    );
    expect(validateComposeMediaFile(makeFile('video/mp4', MAX_VIDEO_BYTES + 1, 'big.mp4'))).toBe(
      'Video must be 50 MB or smaller.',
    );
  });

  it('compose accept string includes image and video types', () => {
    expect(ALLOWED_COMPOSE_MEDIA_ACCEPT).toContain('image/jpeg');
    expect(ALLOWED_COMPOSE_MEDIA_ACCEPT).toContain('video/mp4');
    expect(ALLOWED_COMPOSE_MEDIA_ACCEPT).toContain('video/webm');
  });

  it('isImageFile / isVideoFile helpers', () => {
    expect(isImageFile(makeFile('image/webp', 10, 'a.webp'))).toBe(true);
    expect(isVideoFile(makeFile('video/mp4', 10, 'a.mp4'))).toBe(true);
    expect(isVideoFile(makeFile('image/png', 10, 'a.png'))).toBe(false);
  });
});
