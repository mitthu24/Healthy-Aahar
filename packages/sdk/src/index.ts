import type { ServiceabilityResponse } from '@healthy-aahar/contracts';

/**
 * Typed API client.
 *
 * All three frontends call the API through this package. In PHASE 02 it is
 * generated from the OpenAPI document, so a breaking API change fails the
 * frontend type-check in CI rather than in production (docs/03 §2). PHASE 01
 * hand-writes the small surface that exists today.
 *
 * The same OpenAPI document generates the future Kotlin and Swift clients,
 * which is why this package exists rather than each app calling `fetch`
 * directly (docs/30 §4).
 */

export type ApiClientOptions = {
  baseUrl: string;
  /** Returns a fresh Firebase ID token, or null when signed out. */
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    const token = await this.getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code: string; message: string; request_id?: string };
      } | null;

      // Clients branch on `code`, never on `message` (docs/06 §1.4).
      throw new ApiError(
        body?.error?.code ?? 'INTERNAL_ERROR',
        body?.error?.message ?? 'Request failed',
        res.status,
        body?.error?.request_id,
      );
    }

    return (await res.json()) as T;
  }

  /** Is this pincode serviceable? Always answered by the server (BR-SV1). */
  checkServiceability(pincode: string): Promise<ServiceabilityResponse> {
    return this.request(`/v1/public/serviceability?pincode=${encodeURIComponent(pincode)}`);
  }

  health(): Promise<{ status: string; version: string }> {
    return this.request('/v1/health');
  }
}
