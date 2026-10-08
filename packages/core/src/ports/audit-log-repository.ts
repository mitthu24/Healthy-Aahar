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

export interface AuditLogRepository {
  write(scope: BusinessScope, event: AuditEvent): Promise<void>;
}
