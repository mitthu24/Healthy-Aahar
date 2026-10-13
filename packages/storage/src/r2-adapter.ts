import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  PresignedUpload,
  PresignUploadInput,
  StoragePort,
  StoredObjectInfo,
} from './index.js';

/**
 * S3-compatible object storage adapter (PHASE 05).
 *
 * Cloudflare R2 implements the S3 API, so this is the same client the AWS
 * SDK ships — only `region: 'auto'` and a custom `endpoint` differ from
 * talking to real AWS S3. Locally, `docker-compose.yml`'s `minio` service
 * is the same S3-compatible surface standing in for R2 (docs/27 §7), so
 * this one adapter is exercised by both environments rather than stubbed
 * out locally and only ever running for real in production.
 *
 * `forcePathStyle: true` is required for MinIO (it does not support
 * virtual-hosted-style bucket addressing) and is harmless against R2
 * (R2 supports both).
 */
export type R2AdapterConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** e.g. `https://<account-id>.r2.cloudflarestorage.com` or the local MinIO endpoint. */
  endpoint: string;
  /** Public base URL objects are served from — a custom domain or bucket's public dev URL. */
  publicBaseUrl: string;
  presignTtlSeconds: number;
  /** Advisory only — a presigned PUT URL does not itself enforce a size cap; `headObject` re-checks the real size after upload. */
  maxBytes: number;
};

/** `https://<account-id>.r2.cloudflarestorage.com` — Cloudflare R2's standard S3 API endpoint. */
export function resolveR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function createR2StorageAdapter(config: R2AdapterConfig): StoragePort {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  const publicBase = config.publicBaseUrl.replace(/\/$/, '');

  return {
    async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
      // Server-generated key (the interface's whole point — see index.ts's
      // doc comment): a client-supplied path is a path-traversal/overwrite
      // vector, so `input.prefix` is the only caller-controlled segment,
      // and even that is expected to be built from server-known IDs
      // (e.g. `products/{productId}`), never raw user input.
      const storageKey = `${input.prefix}/${randomUUID()}.${input.extension}`;
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
        ContentType: input.contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: config.presignTtlSeconds,
      });

      return {
        uploadUrl,
        storageKey,
        expiresAt: new Date(Date.now() + config.presignTtlSeconds * 1000),
        maxBytes: config.maxBytes,
        allowedContentType: input.contentType,
      };
    },

    publicUrl(storageKey: string): string {
      return `${publicBase}/${storageKey}`;
    },

    async delete(storageKey: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
    },

    async headObject(storageKey: string): Promise<StoredObjectInfo | null> {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: storageKey }),
        );
        return {
          sizeBytes: result.ContentLength ?? 0,
          contentType: result.ContentType,
        };
      } catch (error) {
        if (error instanceof NotFound) return null;
        // MinIO (and some S3-compatible stores) return a generic 404
        // without the typed NotFound error class the real AWS SDK models.
        if (
          error &&
          typeof error === 'object' &&
          '$metadata' in error &&
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
