/**
 * MIME types accepted by every attachment-upload entry point.
 *
 * Keep this as a Set rather than a plain object: property lookups on an
 * object would treat inherited names such as `constructor` and `__proto__`
 * as allowed values.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

export function isAllowedUploadMimeType(mimeType: string): boolean {
  return ALLOWED_UPLOAD_MIME_TYPES.has(mimeType);
}

export function isImageUploadMimeType(mimeType: string): boolean {
  return isAllowedUploadMimeType(mimeType) && mimeType.startsWith('image/');
}
