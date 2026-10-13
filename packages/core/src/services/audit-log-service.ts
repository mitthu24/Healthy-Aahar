import type { BusinessScope } from '../domain/business-scope.js';
import { buildPage, normaliseLimit, type Page, type PageRequest } from '../domain/pagination.js';
import type {
  AuditLogFilter,
  AuditLogRepository,
  AuditLogRow,
} from '../ports/audit-log-repository.js';

/**
 * Read path for the audit trail every other admin service already writes to
 * (`AuditLogRepository.write`, called from `RbacService`, `AdminCatalogueService`,
 * etc.) — this is the only place that READS it, gated by `audit:read` at the
 * route layer. Deliberately has no write method of its own: every write
 * already happens at the point of the real action, with the actor and
 * context that action already has; a generic "log this" entry point here
 * would just invite inconsistent, context-free audit rows.
 */
export class AuditLogService {
  constructor(private readonly auditLog: AuditLogRepository) {}

  async list(
    scope: BusinessScope,
    filter: AuditLogFilter,
    page: PageRequest,
  ): Promise<Page<AuditLogRow>> {
    const limit = normaliseLimit(page.limit);
    const rows = await this.auditLog.list(scope, filter, {
      limit: limit + 1,
      cursor: page.cursor,
    });
    return buildPage(rows, limit, (row) => ({
      sortValue: row.createdAt.toISOString(),
      id: row.id,
    }));
  }
}
