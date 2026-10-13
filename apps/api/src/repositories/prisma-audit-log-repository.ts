import {
  decodeCursor,
  newId,
  type AuditEvent,
  type AuditLogFilter,
  type AuditLogRepository,
  type AuditLogRow,
  type BusinessScope,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async write(scope: BusinessScope, event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: newId(),
        businessId: scope,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        metadata: event.metadata as never,
      },
    });
  }

  async list(
    scope: BusinessScope,
    filter: AuditLogFilter,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<AuditLogRow[]> {
    // Newest-first keyset pagination on (created_at, id) — the cursor's
    // `sortValue` is createdAt's ISO string, `id` the tie-breaker, matching
    // every other cursor-paginated endpoint's shape (packages/core/src/
    // domain/pagination.ts).
    let cursorFilter: Prisma.AuditLogWhereInput = {};
    if (page.cursor) {
      const { sortValue, id } = decodeCursor(page.cursor);
      const createdAt = new Date(sortValue);
      cursorFilter = {
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, id: { lt: id } },
        ],
      };
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        businessId: scope,
        ...cursorFilter,
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorType: row.actorType as 'ADMIN' | 'SYSTEM',
      actorEmail: row.actorEmail,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
    }));
  }
}
