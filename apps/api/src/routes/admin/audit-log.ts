import {
  auditLogListResponseSchema,
  errorResponseSchema,
  listAuditLogQuerySchema,
} from '@healthy-aahar/contracts';
import { businessScope, type AuditLogRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Read path for the audit trail (docs/08 §7, Phase 05). Gated by `audit:read`
 * alone — distinct from every specific `*:read` permission on the resources
 * being audited, since reviewing who-did-what is its own, narrower
 * administrative concern (typically Super Admin / compliance-only) rather
 * than something every role with e.g. `orders:read` should also see.
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/audit-log',
  audience: 'admin',
  permission: 'audit:read',
  summary: 'Search the audit trail',
  phase: '05',
  openapi: {
    tags: ['Admin: Audit'],
    request: { query: listAuditLogQuerySchema },
    responses: {
      200: { description: 'Audit log entries', schema: auditLogListResponseSchema },
      422: jsonError('Invalid cursor or filter value'),
    },
  },
});

function toResponse(row: AuditLogRow) {
  return {
    id: row.id,
    actor_user_id: row.actorUserId,
    actor_type: row.actorType,
    actor_email: row.actorEmail,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    metadata: row.metadata,
    created_at: row.createdAt.toISOString(),
  };
}

export function auditLogRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const query = listAuditLogQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);

    const page = await c.env.services.auditLog.list(
      scope,
      {
        actorUserId: query.actor_user_id,
        action: query.action,
        resourceType: query.resource_type,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      { limit: query.limit ?? 20, cursor: query.cursor },
    );

    return c.json({
      data: page.data.map(toResponse),
      pagination: page.pagination,
    });
  });

  return app;
}
