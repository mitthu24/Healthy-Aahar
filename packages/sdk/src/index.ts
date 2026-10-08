import type {
  AdminMe,
  CityListResponse,
  CityPublic,
  CustomerSessionResponse,
  PincodeListResponse,
  ServiceabilityResponse,
} from '@healthy-aahar/contracts';

/**
 * Typed API client.
 *
 * All three frontends call the API through this package, and the future
 * Android and iOS apps will call the same endpoints with a client generated
 * from the same OpenAPI document (docs/30 §4). Response types are imported
 * from `@healthy-aahar/contracts` — the exact schemas the API validates
 * with — so a breaking API change fails the frontend type-check in CI rather
 * than in production.
 */

export type ApiClientOptions = {
  baseUrl: string;
  /**
   * Returns the customer's current bearer session token (from
   * `customerLogin`/`customerRegister`), or null when signed out (PHASE 03
   * — docs/30 §2). The caller owns where this is stored (memory, secure
   * native storage); the SDK never persists it.
   */
  getToken?: () => Promise<string | null>;
  /**
   * Reads the non-HttpOnly CSRF cookie value set alongside the admin
   * session cookie, echoed back as `X-CSRF-Token` on mutating admin
   * requests (docs/23 §6). Only relevant to admin methods.
   */
  getCsrfToken?: () => string | undefined;
  /** Identifies the caller, enabling minimum-version gating later (docs/06 §1.2). */
  clientId?: string;
  fetchImpl?: typeof fetch;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: Array<{ field?: string; issue: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type PageParams = {
  limit?: number;
  /** Opaque. Never construct or parse one — it encodes our sort order. */
  cursor?: string;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: () => Promise<string | null>;
  private readonly getCsrfToken?: () => string | undefined;
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getToken = options.getToken;
    this.getCsrfToken = options.getCsrfToken;
    this.clientId = options.clientId ?? 'web/0.2.0';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private query(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const qs = search.toString();
    return qs ? `?${qs}` : '';
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-Client', this.clientId);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const token = await this.getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const csrfToken = this.getCsrfToken?.();
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      // The admin session is an HttpOnly cookie (PHASE 03) — browser fetch
      // needs this explicitly or it never sends/receives it cross-origin
      // between a Vercel-hosted app and the API's own domain.
      credentials: 'include',
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: {
          code: string;
          message: string;
          request_id?: string;
          details?: Array<{ field?: string; issue: string }>;
        };
      } | null;

      // Clients branch on `code`, never on `message` (docs/06 §1.4).
      throw new ApiError(
        body?.error?.code ?? 'INTERNAL_ERROR',
        body?.error?.message ?? 'Request failed',
        res.status,
        body?.error?.request_id,
        body?.error?.details,
      );
    }

    return (await res.json()) as T;
  }

  // ── Health ──────────────────────────────────────────────────────────────

  health(): Promise<{ status: string; version: string; env: string }> {
    return this.request('/v1/health');
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /**
   * Is this pincode serviceable?
   *
   * Always answered by the server from live database state. There is
   * deliberately no way to assert serviceability from the client (BR-SV1).
   * A non-serviceable pincode resolves normally with `is_serviceable: false`
   * — it is not an error (BR-SV11).
   */
  checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
    return this.request(`/v1/public/serviceability${this.query({ pincode })}`);
  }

  listPublicCities(): Promise<{ data: CityPublic[] }> {
    return this.request('/v1/public/cities');
  }

  // ── Customer auth (PHASE 03 — email/password, bearer session token) ─────

  customerRegister(body: {
    email: string;
    password: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<CustomerSessionResponse> {
    return this.request('/v1/auth/register', { method: 'POST', body: JSON.stringify(body) });
  }

  customerLogin(body: { email: string; password: string }): Promise<CustomerSessionResponse> {
    return this.request('/v1/auth/login', { method: 'POST', body: JSON.stringify(body) });
  }

  customerLogout(): Promise<{ signed_out: boolean }> {
    return this.request('/v1/auth/logout', { method: 'POST' });
  }

  // ── Admin auth (PHASE 03 — email/password, DB-backed session cookie) ────

  adminLogin(body: { email: string; password: string }): Promise<AdminMe> {
    return this.request('/v1/admin/auth/login', { method: 'POST', body: JSON.stringify(body) });
  }

  adminLogout(): Promise<{ signed_out: boolean }> {
    return this.request('/v1/admin/auth/logout', { method: 'POST' });
  }

  adminMe(): Promise<AdminMe> {
    return this.request('/v1/admin/auth/me');
  }

  // ── Admin (PHASE 02 foundation) ─────────────────────────────────────────

  listCities(
    params: PageParams & { status?: string; state?: string; q?: string } = {},
  ): Promise<CityListResponse> {
    return this.request(`/v1/admin/cities${this.query(params)}`);
  }

  listServicePincodes(
    params: PageParams & { city_id?: string; status?: string; q?: string } = {},
  ): Promise<PincodeListResponse> {
    return this.request(`/v1/admin/service-pincodes${this.query(params)}`);
  }

  /** Walk every page. The cursor stays opaque to the caller. */
  async *iterateServicePincodes(
    params: { city_id?: string; status?: string; limit?: number } = {},
  ): AsyncGenerator<PincodeListResponse['data'][number]> {
    let cursor: string | undefined;

    do {
      const page: PincodeListResponse = await this.listServicePincodes({ ...params, cursor });
      for (const row of page.data) yield row;
      cursor = page.pagination.next_cursor ?? undefined;
    } while (cursor);
  }
}

export type {
  AdminMe,
  CityListResponse,
  CityPublic,
  CustomerSessionResponse,
  PincodeListResponse,
  ServiceabilityResponse,
} from '@healthy-aahar/contracts';
