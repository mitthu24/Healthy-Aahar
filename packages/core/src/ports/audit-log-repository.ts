import type { BusinessScope } from '../domain/business-scope.js';

/**
 * `audit_logs` writes (docs/08 §5.3). Every permission-relevant event is
 * recorded, including denials — a denial is the interesting security signal.
 */
export type AuditEvent = {
  actorUserId: string | null;
  actorType: 'ADMIN' | 'SYSTEM';
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type AuditLogRow = {
  id: string;
  actorUserId: string | null;
  actorType: 'ADMIN' | 'SYSTEM';
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type AuditLogFilter = {
  actorUserId?: string | undefined;
  action?: string | undefined;
  resourceType?: string | undefined;
  /** Inclusive. */
  from?: Date | undefined;
  /** Inclusive. */
  to?: Date | undefined;
};

export interface AuditLogRepository {
  write(scope: BusinessScope, event: AuditEvent): Promise<void>;

  /** Newest first. `cursor`/`limit` follow the same cursor-pagination shape as every other list endpoint. */
  list(
    scope: BusinessScope,
    filter: AuditLogFilter,
    page: { limit: number; cursor?: string | undefined },
  ): Promise<AuditLogRow[]>;
}
