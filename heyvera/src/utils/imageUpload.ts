/** Shared image + progressive-video limits for compose uploads (mirror BE media.rs). */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

export const ALLOWED_IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
export const ALLOWED_VIDEO_ACCEPT = 'video/mp4,video/webm';

/** Compose: one image OR one progressive video (mp4/webm). */
export const ALLOWED_COMPOSE_MEDIA_ACCEPT = `${ALLOWED_IMAGE_ACCEPT},${ALLOWED_VIDEO_ACCEPT}`;

export function isImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
}

export function isVideoFile(file: File): boolean {
  return ALLOWED_VIDEO_TYPES.has(file.type);
}

/**
 * Validate a local image file for upload.
 * @returns null if valid, otherwise a user-facing error message.
 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return 'Use a JPEG, PNG, GIF, or WebP image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Image must be 10 MB or smaller.';
  }
  return null;
}

/**
 * Validate a local progressive video file (mirror BE: mp4/webm, 50 MB).
 * @returns null if valid, otherwise a user-facing error message.
 */
export function validateVideoFile(file: File): string | null {
  if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
    return 'Use an MP4 or WebM video.';
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return 'Video must be 50 MB or smaller.';
  }
  return null;
}

/**
 * Validate a single compose attachment: one image OR one progressive video.
 * @returns null if valid, otherwise a user-facing error message.
 */
export function validateComposeMediaFile(file: File): string | null {
  if (ALLOWED_IMAGE_TYPES.has(file.type)) {
    return validateImageFile(file);
  }
  if (ALLOWED_VIDEO_TYPES.has(file.type)) {
    return validateVideoFile(file);
  }
  return 'Use a JPEG, PNG, GIF, WebP image or an MP4/WebM video.';
}
