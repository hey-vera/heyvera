/** Shared image limits for compose + profile avatar/banner uploads. */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const ALLOWED_IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

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
