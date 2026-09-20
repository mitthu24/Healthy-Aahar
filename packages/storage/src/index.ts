/**
 * Object storage port (docs/23-SECURITY-ARCHITECTURE.md §9).
 *
 * Uploads use presigned URLs so image bytes never transit our API. Three
 * properties of the presign are part of this interface rather than left to
 * the caller, because each one is a vulnerability if the caller gets it wrong:
 *
 *   - the object key is generated SERVER-side (a client-supplied path is a
 *     path-traversal and overwrite vector),
 *   - the content type is constrained by the signature, not merely requested,
 *   - the maximum size is capped by the signature.
 *
 * PHASE 05 implements the R2 adapter and the validating worker (magic bytes,
 * dimensions, EXIF strip).
 */

export type PresignedUpload = {
  uploadUrl: string;
  /** Server-generated. The caller does not choose where the object lands. */
  storageKey: string;
  expiresAt: Date;
  maxBytes: number;
  allowedContentType: string;
};

export type PresignUploadInput = {
  /** Logical folder, e.g. `products/{productId}`. Never raw user input. */
  prefix: string;
  contentType: string;
  extension: string;
};

export interface StoragePort {
  presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  publicUrl(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}
