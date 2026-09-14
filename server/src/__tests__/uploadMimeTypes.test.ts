import {
  ALLOWED_UPLOAD_MIME_TYPES,
  isAllowedUploadMimeType,
  isImageUploadMimeType,
} from '../utils/uploadMimeTypes';

describe('shared upload MIME allowlist', () => {
  it('keeps the established upload MIME types and image classification', () => {
    expect([...ALLOWED_UPLOAD_MIME_TYPES]).toEqual([
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
    expect(isImageUploadMimeType('image/png')).toBe(true);
    expect(isImageUploadMimeType('application/pdf')).toBe(false);
  });

  it.each(['constructor', '__proto__'])('rejects inherited object key %s', (mimeType) => {
    expect(isAllowedUploadMimeType(mimeType)).toBe(false);
    expect(isImageUploadMimeType(mimeType)).toBe(false);
  });
});
