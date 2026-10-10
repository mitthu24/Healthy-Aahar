import {
  newId,
  type AuditEvent,
  type AuditLogRepository,
  type BusinessScope,
} from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

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
}
