import {
  extendZodWithOpenApi,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { errorResponseSchema } from './errors.js';

// Adds .openapi() to every Zod schema in the process. Called once, here.
extendZodWithOpenApi(z);

/**
 * OpenAPI 3.1 generation.
 *
 * The document is built from the SAME Zod schemas the API validates with, so
 * it cannot drift from the implementation — there is no second, hand-written
 * schema to forget to update (docs/03 §2).
 *
 * This wraps `@asteasolutions/zod-to-openapi` directly rather than using
 * `@hono/zod-openapi`, because our route registry already carries audience
 * and permission metadata that the Hono wrapper does not model, and that
 * metadata is a real security control we assert at boot (ADR-031).
 */

export type OpenApiRouteSpec = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  /** Audience drives the security requirement shown in the document. */
  audience: 'public' | 'customer' | 'admin' | 'internal' | 'webhook';
  permission?: string | undefined;
  request?: {
    query?: z.ZodTypeAny;
    params?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  /** Status code -> response schema. */
  responses: Record<number, { description: string; schema?: z.ZodTypeAny }>;
  deprecated?: boolean;
};

const AUDIENCE_SECURITY: Record<OpenApiRouteSpec['audience'], string[]> = {
  public: [],
  customer: ['customerBearer'],
  admin: ['adminSession'],
  internal: ['internalToken'],
  webhook: [],
};

export type OpenApiDocumentOptions = {
  version: string;
  serverUrl: string;
  environment: string;
};

export function buildOpenApiDocument(
  routes: readonly OpenApiRouteSpec[],
  options: OpenApiDocumentOptions,
): object {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'customerBearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Firebase ID token from the CUSTOMER project. A token from the admin ' +
      'project is rejected: the audiences differ (ADR-010).',
  });

  registry.registerComponent('securitySchemes', 'adminSession', {
    type: 'apiKey',
    in: 'cookie',
    name: '__Host-admin_session',
    description:
      'Admin session cookie, set by POST /v1/admin/auth/session. HttpOnly, ' +
      'Secure, SameSite=Strict (PHASE 03).',
  });

  registry.registerComponent('securitySchemes', 'internalToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Internal-Token',
    description: 'Worker-to-API service token. Not routable from the internet.',
  });

  for (const route of routes) {
    const config: RouteConfig = {
      method: route.method,
      path: route.path,
      summary: route.summary,
      tags: route.tags,
      ...(route.description ? { description: route.description } : {}),
      ...(route.deprecated ? { deprecated: true } : {}),
      request: {
        ...(route.request?.query ? { query: route.request.query as never } : {}),
        ...(route.request?.params ? { params: route.request.params as never } : {}),
        ...(route.request?.body
          ? {
              body: {
                content: { 'application/json': { schema: route.request.body } },
              },
            }
          : {}),
      },
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            ...(response.schema
              ? { content: { 'application/json': { schema: response.schema } } }
              : {}),
          },
        ]),
      ),
    };

    const security = AUDIENCE_SECURITY[route.audience];
    if (security.length > 0) {
      config.security = security.map((name) => ({ [name]: [] }));
    }

    registry.registerPath(config);
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Healthy Aahar API',
      version: options.version,
      description: [
        'Fresh, healthy food delivery platform.',
        '',
        'This document is generated from the same Zod schemas the API',
        'validates with, so it cannot drift from the implementation.',
        '',
        'Money is always `{ amount_paise, currency, display }` — never a bare',
        'number and never a float (ADR-006).',
        '',
        'Collections use CURSOR pagination, never offset: offset skips or',
        'repeats rows when the underlying set changes between pages.',
        '',
        'Clients branch on `error.code`, never on `error.message`. Codes are',
        'part of the contract; messages may be reworded at any time.',
      ].join('\n'),
      contact: { name: 'Healthy Aahar Engineering' },
    },
    servers: [{ url: options.serverUrl, description: options.environment }],
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes' },
      { name: 'Serviceability', description: 'Where Healthy Aahar delivers' },
      { name: 'Admin: Cities', description: 'Admin city configuration' },
      { name: 'Admin: Pincodes', description: 'Admin pincode configuration' },
    ],
  });
}

/** Every endpoint can return these, so they are declared in one place. */
export const COMMON_ERROR_RESPONSES = {
  422: { description: 'Validation failed', schema: errorResponseSchema },
  429: { description: 'Rate limited', schema: errorResponseSchema },
  500: { description: 'Internal error', schema: errorResponseSchema },
} as const;

export { z };
