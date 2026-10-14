import type * as S3ClientModule from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof S3ClientModule>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function MockS3Client() {
      return { send: sendMock };
    }),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://storage.test/presigned?signature=abc'),
}));

const { createR2StorageAdapter, resolveR2Endpoint } = await import('./r2-adapter.js');
const { NotFound } = await import('@aws-sdk/client-s3');

function adapter() {
  return createR2StorageAdapter({
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    bucket: 'test-bucket',
    endpoint: 'https://storage.test',
    publicBaseUrl: 'https://cdn.test/test-bucket',
    presignTtlSeconds: 300,
    maxBytes: 5_000_000,
  });
}

beforeEach(() => {
  sendMock.mockReset();
});

describe('createR2StorageAdapter', () => {
  it('generates a server-side key under the given prefix, never trusting a client-supplied path', async () => {
    const result = await adapter().presignUpload({
      prefix: 'products/abc-123',
      contentType: 'image/png',
      extension: 'png',
    });

    expect(result.storageKey).toMatch(/^products\/abc-123\/[0-9a-f-]{36}\.png$/);
    expect(result.uploadUrl).toBe('https://storage.test/presigned?signature=abc');
    expect(result.maxBytes).toBe(5_000_000);
    expect(result.allowedContentType).toBe('image/png');
  });

  it('builds the public URL by joining the configured base with the storage key', () => {
    expect(adapter().publicUrl('products/x/y.png')).toBe(
      'https://cdn.test/test-bucket/products/x/y.png',
    );
  });

  it('headObject returns size and content type for an object that exists', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 2048, ContentType: 'image/webp' });

    const result = await adapter().headObject('products/x/y.webp');

    expect(result).toEqual({ sizeBytes: 2048, contentType: 'image/webp' });
  });

  it('headObject returns null for a NotFound error (nothing was actually uploaded)', async () => {
    sendMock.mockRejectedValueOnce(
      new NotFound({ message: 'not found', $metadata: { httpStatusCode: 404 } }),
    );

    expect(await adapter().headObject('products/x/missing.png')).toBeNull();
  });

  it('headObject returns null for a generic 404 from an S3-compatible store that does not use the typed NotFound class (e.g. some MinIO responses)', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } }),
    );

    expect(await adapter().headObject('products/x/missing.png')).toBeNull();
  });

  it('headObject rethrows a real storage error (e.g. network/5xx) rather than masking it as "not found"', async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('internal error'), { $metadata: { httpStatusCode: 500 } }),
    );

    await expect(adapter().headObject('products/x/y.png')).rejects.toThrow('internal error');
  });

  it('delete sends a DeleteObjectCommand for the given key', async () => {
    sendMock.mockResolvedValueOnce({});
    await adapter().delete('products/x/y.png');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'products/x/y.png' });
  });
});

describe('resolveR2Endpoint', () => {
  it('builds the standard Cloudflare R2 S3 API endpoint from an account id', () => {
    expect(resolveR2Endpoint('abc123')).toBe('https://abc123.r2.cloudflarestorage.com');
  });
});
