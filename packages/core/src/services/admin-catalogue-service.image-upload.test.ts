import { beforeEach, describe, expect, it } from 'vitest';

import { businessScope, type BusinessScope } from '../domain/business-scope.js';
import type { AuditEvent, AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  AdminCategoryRepository,
  AdminProductRepository,
  AdminProductRow,
  AdminVariantRepository,
} from '../ports/admin-catalogue-repository.js';
import { AdminCatalogueService } from './admin-catalogue-service.js';

/**
 * Covers the PHASE 05 device-upload flow (not the audit/CRUD paths
 * `admin-delivery-slot-service.test.ts`-style fakes already prove
 * elsewhere): authorized upload succeeds end to end, an unsupported
 * content type is rejected before any presign, a confirm independently
 * re-verifies what storage actually has rather than trusting the client,
 * and the pre-existing direct-URL path (`addProductImage`) is unaffected.
 */

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');
const PRODUCT_ID = '0193bbbb-0000-7000-8000-000000000001';
const ACTOR_ID = '0193cccc-0000-7000-8000-000000000001';

function productRow(overrides: Partial<AdminProductRow> = {}): AdminProductRow {
  return {
    id: PRODUCT_ID,
    businessId: BUSINESS_ID,
    name: 'Millet Mix',
    slug: 'millet-mix',
    shortDescription: null,
    description: null,
    ingredients: null,
    status: 'DRAFT',
    categoryId: '0193dddd-0000-7000-8000-000000000001',
    categoryName: 'Grains',
    allergens: [],
    dietaryTags: [],
    isBestseller: false,
    isNew: false,
    images: [],
    variants: [],
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type ImageRecord = { id: string; storageKey: string; url: string; status: 'PENDING' | 'READY' | 'FAILED' };

/** In-memory repository — same pattern as admin-delivery-slot-service.test.ts. */
class FakeProductRepository implements AdminProductRepository {
  readonly images = new Map<string, ImageRecord>();
  private nextId = 1;
  product: AdminProductRow;

  constructor(initial: AdminProductRow) {
    this.product = initial;
  }

  private withImages(): AdminProductRow {
    return {
      ...this.product,
      images: [...this.images.values()]
        .filter((i) => i.status === 'READY')
        .map((i) => ({ id: i.id, url: i.url, altText: null, displayOrder: 0 })),
    };
  }

  async list() {
    return [];
  }
  async findById(_scope: BusinessScope, id: string): Promise<AdminProductRow | null> {
    return id === this.product.id ? this.withImages() : null;
  }
  async create(): Promise<AdminProductRow> {
    throw new Error('not used in these tests');
  }
  async update(): Promise<AdminProductRow> {
    throw new Error('not used in these tests');
  }
  async setStatus(): Promise<AdminProductRow> {
    throw new Error('not used in these tests');
  }

  async addImage(
    _scope: BusinessScope,
    _productId: string,
    input: { url: string; altText?: string | undefined; displayOrder: number },
  ): Promise<AdminProductRow> {
    const id = `img-${this.nextId++}`;
    // Mirrors PrismaAdminProductRepository.addImage exactly: storageKey is
    // the pasted URL itself, status READY immediately.
    this.images.set(id, { id, storageKey: input.url, url: input.url, status: 'READY' });
    return this.withImages();
  }

  async removeImage(_scope: BusinessScope, _productId: string, imageId: string) {
    this.images.delete(imageId);
    return this.withImages();
  }

  async createPendingImage(
    _scope: BusinessScope,
    _productId: string,
    input: { storageKey: string; url: string; altText?: string | undefined; displayOrder: number },
  ): Promise<{ id: string }> {
    const id = `img-${this.nextId++}`;
    this.images.set(id, { id, storageKey: input.storageKey, url: input.url, status: 'PENDING' });
    return { id };
  }

  async findImage(_scope: BusinessScope, _productId: string, imageId: string) {
    const image = this.images.get(imageId);
    return image ? { id: image.id, storageKey: image.storageKey, status: image.status } : null;
  }

  async confirmImage(_scope: BusinessScope, _productId: string, imageId: string) {
    const image = this.images.get(imageId);
    if (image) image.status = 'READY';
    return this.withImages();
  }
}

type StoredObject = { sizeBytes: number; contentType: string };

/** In-memory object store — stands in for the real R2/S3 adapter under test. */
class FakeStoragePort {
  readonly objects = new Map<string, StoredObject>();
  /** Set by a test to simulate "the client never actually uploaded anything". */
  simulateMissingUpload = false;

  async presignUpload(input: { prefix: string; contentType: string; extension: string }) {
    const storageKey = `${input.prefix}/fake-key.${input.extension}`;
    if (!this.simulateMissingUpload) {
      // Simulates the client's direct PUT to the presigned URL succeeding —
      // tests that want to exercise a FAILED upload set
      // `simulateMissingUpload = true` instead of calling this.
      this.objects.set(storageKey, { sizeBytes: 1024, contentType: input.contentType });
    }
    return {
      uploadUrl: `https://fake-storage.test/${storageKey}?signature=abc`,
      storageKey,
      expiresAt: new Date(Date.now() + 300_000),
      maxBytes: 5_000_000,
      allowedContentType: input.contentType,
    };
  }

  publicUrl(storageKey: string): string {
    return `https://fake-storage.test/public/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }

  async headObject(storageKey: string) {
    const object = this.objects.get(storageKey);
    return object ? { sizeBytes: object.sizeBytes, contentType: object.contentType } : null;
  }
}

function fakeAuditLog(): AuditLogRepository & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async write(_scope, event) {
      events.push(event as unknown as AuditEvent);
    },
  } as AuditLogRepository & { events: AuditEvent[] };
}

let products: FakeProductRepository;
let storage: FakeStoragePort;
let audit: ReturnType<typeof fakeAuditLog>;
let service: AdminCatalogueService;

beforeEach(() => {
  products = new FakeProductRepository(productRow());
  storage = new FakeStoragePort();
  audit = fakeAuditLog();
  service = new AdminCatalogueService({
    categories: {} as AdminCategoryRepository,
    products,
    variants: {} as AdminVariantRepository,
    audit,
    storage,
    maxUploadBytes: 2_000_000,
  });
});

describe('AdminCatalogueService — device image upload (PHASE 05)', () => {
  it('issues a presigned upload for an authorized request with an allowed content type', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/webp', displayOrder: 0 },
      ACTOR_ID,
    );

    expect(ticket.uploadUrl).toMatch(/^https:\/\/fake-storage\.test\//);
    expect(ticket.maxBytes).toBe(2_000_000);
    expect(products.images.get(ticket.imageId)?.status).toBe('PENDING');
    expect(audit.events.map((e) => e.action)).toContain('product.image_upload_requested');
  });

  it('rejects an unsupported content type before ever presigning', async () => {
    await expect(
      service.requestProductImageUpload(
        BUSINESS_ID,
        PRODUCT_ID,
        { contentType: 'application/pdf', displayOrder: 0 },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(products.images.size).toBe(0);
  });

  it('refuses for a product that does not exist, before touching storage at all', async () => {
    await expect(
      service.requestProductImageUpload(
        BUSINESS_ID,
        'nonexistent-product',
        { contentType: 'image/jpeg', displayOrder: 0 },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    expect(storage.objects.size).toBe(0);
  });

  it('confirms a genuinely completed upload and makes the image visible on the product', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );

    const updated = await service.confirmProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      ticket.imageId,
      ACTOR_ID,
    );

    expect(products.images.get(ticket.imageId)?.status).toBe('READY');
    expect(updated.images).toHaveLength(1);
    expect(audit.events.map((e) => e.action)).toContain('product.image_upload_confirmed');
  });

  it('refuses to confirm when nothing was actually uploaded, and cleans up the PENDING row', async () => {
    storage.simulateMissingUpload = true;
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );
    expect(storage.objects.size).toBe(0); // confirms the simulation actually took effect

    await expect(
      service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Orphaned PENDING row must not survive a failed confirm.
    expect(products.images.has(ticket.imageId)).toBe(false);
  });

  it('refuses to confirm an upload that exceeds the configured size limit, and deletes the oversized object', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );
    const storageKey = products.images.get(ticket.imageId)!.storageKey;
    storage.objects.set(storageKey, { sizeBytes: 9_000_000, contentType: 'image/png' });

    await expect(
      service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID),
    ).rejects.toThrow(/exceeds/);

    expect(storage.objects.has(storageKey)).toBe(false);
    expect(products.images.has(ticket.imageId)).toBe(false);
  });

  it('refuses to confirm when the actually-stored content type is not an allowed image type (client lied about Content-Type)', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );
    const storageKey = products.images.get(ticket.imageId)!.storageKey;
    storage.objects.set(storageKey, { sizeBytes: 1024, contentType: 'application/x-msdownload' });

    await expect(
      service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(storage.objects.has(storageKey)).toBe(false);
  });

  it('refuses to confirm the same image twice', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );
    await service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID);

    await expect(
      service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('removing an uploaded image deletes the underlying storage object', async () => {
    const ticket = await service.requestProductImageUpload(
      BUSINESS_ID,
      PRODUCT_ID,
      { contentType: 'image/png', displayOrder: 0 },
      ACTOR_ID,
    );
    const storageKey = products.images.get(ticket.imageId)!.storageKey;
    await service.confirmProductImageUpload(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID);
    expect(storage.objects.has(storageKey)).toBe(true);

    await service.removeProductImage(BUSINESS_ID, PRODUCT_ID, ticket.imageId, ACTOR_ID);

    expect(storage.objects.has(storageKey)).toBe(false);
    expect(products.images.has(ticket.imageId)).toBe(false);
  });

  it('existing product compatibility: the pasted-URL path (addProductImage) is untouched and never touches storage', async () => {
    const updated = await service.addProductImage(
      BUSINESS_ID,
      PRODUCT_ID,
      { url: 'https://already-hosted.example.test/pic.jpg', displayOrder: 0 },
      ACTOR_ID,
    );
    expect(updated.images).toHaveLength(1);
    expect(storage.objects.size).toBe(0);

    // And removing it must NOT call storage.delete with a URL as a key —
    // the removeProductImage guard (storageKey.startsWith('http')) exists
    // exactly to prevent that.
    const imageId = updated.images[0]!.id;
    await service.removeProductImage(BUSINESS_ID, PRODUCT_ID, imageId, ACTOR_ID);
    expect(products.images.has(imageId)).toBe(false);
  });
});
