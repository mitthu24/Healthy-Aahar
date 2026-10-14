import type {
  AddressDto,
  AddressListResponse,
  AdminCategoryDto,
  AdminCategoryListResponse,
  AdminDeliverySlotDto,
  AdminDeliverySlotListResponse,
  AdminMe,
  AdminOrderDto,
  AdminOrderListResponse,
  AdminProductDto,
  AdminProductListResponse,
  AdminVariantDto,
  AdminUser,
  AuditLogEntry,
  CartDto,
  CategoryDto,
  CityListResponse,
  CityPublic,
  CustomerSessionResponse,
  DashboardSummary,
  DeliveryDashboardDto,
  DeliveryOrderDto,
  DeliveryOrderListResponse,
  DeliveryPartnerDto,
  DeliveryPartnerListResponse,
  DeliverySlotListResponse,
  AssignmentHistoryEntryDto,
  InventoryAlertsResponse,
  OrderDto,
  OrderListResponse,
  PincodeListResponse,
  ProductDetailDto,
  ProductListResponse,
  Role,
  Permission,
  SalesTrendResponse,
  ServiceabilityResponse,
  TopProductsResponse,
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
  /**
   * The admin CSRF token, captured from the `X-CSRF-Token` response header
   * on ANY response that carries it (today: `POST /admin/auth/login` and
   * `GET /admin/auth/me`, and CORS already exposes the header globally).
   * This is the ONLY reliable source when the admin app and API are on
   * different origins: the `admin_csrf` cookie the header's value also
   * gets written into is set by the API's own origin, and a browser never
   * lets JS on a different origin read it via `document.cookie` — no
   * `SameSite` or `Secure` setting changes that. The browser still
   * ATTACHES the cookie to outgoing same-session requests on its own
   * (that part only needed `SameSite=None`); this field supplies the
   * matching header value the server's double-submit check compares it
   * against. A caller-supplied `getCsrfToken` (e.g. reading a cookie that
   * genuinely is same-origin) still takes priority when provided.
   *
   * `/admin/auth/me` re-sends this header specifically so a hard page
   * reload (which resets this in-memory field to `undefined`) doesn't
   * permanently 403 every mutating request until the next login —
   * `AuthGate` in the admin app calls `/me` on every mount and route
   * change, before rendering any protected page, so this field is
   * re-populated before a user can reach a form that would need it.
   */
  private csrfToken: string | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getToken = options.getToken;
    this.getCsrfToken = options.getCsrfToken;
    this.clientId = options.clientId ?? 'web/0.2.0';
    // Bound explicitly: native `fetch` is receiver-checked (browsers throw
    // "Illegal invocation" when it's called as `this.fetchImpl(...)` with
    // `this` set to the ApiClient instance rather than `window`/`self`) —
    // storing the bare function reference on `this` and later invoking it
    // as `this.fetchImpl(...)` hits exactly that, in every browser, for
    // every request this client ever makes. `.bind()` is a no-op for an
    // already-bound or arrow-function `options.fetchImpl` (e.g. a test
    // double), so this is safe for both the default and the override.
    this.fetchImpl = (options.fetchImpl ?? fetch).bind(globalThis);
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
      const csrfToken = this.getCsrfToken?.() ?? this.csrfToken;
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

    // Captured on every response that carries it (today: admin login and
    // admin/auth/me) — see the `csrfToken` field doc for why this, not a
    // cookie read, is the real source of truth cross-origin, and why
    // admin/auth/me resending it matters after a hard reload.
    const csrfHeader = res.headers.get('X-CSRF-Token');
    if (csrfHeader) this.csrfToken = csrfHeader;

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

  /** `email` also accepts a Stage C login ID — the field name is kept for
   *  backward compatibility; see `adminLoginBodySchema`'s doc comment. */
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

  // ── Admin: self-service password change (PHASE 04) ──────────────────────

  adminChangePassword(body: {
    current_password: string;
    new_password: string;
  }): Promise<{ changed: boolean }> {
    return this.request('/v1/admin/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── One-time password setup (invite/bootstrap token — audience-agnostic,
  // docs/07 §5.1) — no session required, the token itself identifies the
  // account. ─────────────────────────────────────────────────────────────

  passwordSetup(body: { token: string; password: string }): Promise<{ ok: boolean }> {
    return this.request('/v1/auth/password/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── Catalogue (PHASE 04) ─────────────────────────────────────────────────

  listCategories(): Promise<{ data: CategoryDto[] }> {
    return this.request('/v1/public/categories');
  }

  listProducts(
    params: PageParams & { category_id?: string; q?: string } = {},
  ): Promise<ProductListResponse> {
    return this.request(`/v1/public/products${this.query(params)}`);
  }

  getProduct(slug: string): Promise<ProductDetailDto> {
    return this.request(`/v1/public/products/${encodeURIComponent(slug)}`);
  }

  // ── Cart (PHASE 04) ──────────────────────────────────────────────────────

  getCart(): Promise<CartDto> {
    return this.request('/v1/me/cart');
  }

  addCartItem(body: { variant_id: string; quantity: number }): Promise<CartDto> {
    return this.request('/v1/me/cart/items', { method: 'POST', body: JSON.stringify(body) });
  }

  updateCartItem(itemId: string, body: { quantity: number }): Promise<CartDto> {
    return this.request(`/v1/me/cart/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  removeCartItem(itemId: string): Promise<CartDto> {
    return this.request(`/v1/me/cart/items/${itemId}`, { method: 'DELETE' });
  }

  // ── Addresses (PHASE 04) ─────────────────────────────────────────────────

  listAddresses(): Promise<AddressListResponse> {
    return this.request('/v1/me/addresses');
  }

  createAddress(body: {
    label?: string;
    recipient_name: string;
    recipient_phone: string;
    line1: string;
    line2?: string;
    landmark?: string;
    city: string;
    state: string;
    pincode: string;
    delivery_instructions?: string;
    is_default?: boolean;
  }): Promise<AddressDto> {
    return this.request('/v1/me/addresses', { method: 'POST', body: JSON.stringify(body) });
  }

  updateAddress(
    id: string,
    body: Partial<Parameters<ApiClient['createAddress']>[0]>,
  ): Promise<AddressDto> {
    return this.request(`/v1/me/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  deleteAddress(id: string): Promise<void> {
    return this.request(`/v1/me/addresses/${id}`, { method: 'DELETE' });
  }

  // ── Delivery slots (PHASE 04 — delivery-slot-only, no address/zone) ──────

  /**
   * `serviceDate` (YYYY-MM-DD) is optional; omitting it returns every active
   * slot with no capacity computed (`remaining_capacity: null`). Passing it
   * filters to slots offered on that date's weekday and computes live
   * remaining capacity server-side.
   */
  listDeliverySlots(serviceDate?: string): Promise<DeliverySlotListResponse> {
    return this.request(`/v1/me/delivery-slots${this.query({ service_date: serviceDate })}`);
  }

  // ── Checkout & orders (PHASE 04) ─────────────────────────────────────────

  /**
   * `idempotencyKey` must be a fresh, client-generated value for a NEW
   * checkout attempt, and the SAME value for a retry of one that may not
   * have reached the server (BR per docs/19, Phase 04 requirement change).
   */
  checkout(
    body: {
      address_id: string;
      delivery_slot_id: string;
      service_date: string;
      customer_note?: string;
    },
    idempotencyKey: string,
  ): Promise<OrderDto> {
    return this.request('/v1/me/orders', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  listMyOrders(params: PageParams = {}): Promise<OrderListResponse> {
    return this.request(`/v1/me/orders${this.query(params)}`);
  }

  getMyOrder(id: string): Promise<OrderDto> {
    return this.request(`/v1/me/orders/${id}`);
  }

  cancelMyOrder(id: string): Promise<OrderDto> {
    return this.request(`/v1/me/orders/${id}/cancel`, { method: 'POST' });
  }

  // ── Admin: orders (PHASE 04) ─────────────────────────────────────────────

  listAdminOrders(
    params: PageParams & {
      status?: string;
      assigned_partner_id?: string;
      unassigned?: boolean;
    } = {},
  ): Promise<AdminOrderListResponse> {
    return this.request(
      `/v1/admin/orders${this.query({ ...params, unassigned: params.unassigned === undefined ? undefined : String(params.unassigned) })}`,
    );
  }

  getAdminOrder(id: string): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${id}`);
  }

  updateAdminOrderStatus(
    id: string,
    body: { to_status: string; reason?: string },
  ): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  rejectAdminOrder(id: string, reason: string): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  holdAdminOrder(id: string, note: string): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  }

  recordCodCollection(id: string, amountPaise: number): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${id}/cod-collection`, {
      method: 'POST',
      body: JSON.stringify({ amount_paise: amountPaise }),
    });
  }

  // ── Admin: delivery partners & order assignment (Phase 06) ──────────────

  listDeliveryPartners(
    params: { q?: string; duty_status?: 'ON_DUTY' | 'OFF_DUTY' } = {},
  ): Promise<DeliveryPartnerListResponse> {
    return this.request(`/v1/admin/delivery-partners${this.query(params)}`);
  }

  getDeliveryPartner(id: string): Promise<DeliveryPartnerDto> {
    return this.request(`/v1/admin/delivery-partners/${id}`);
  }

  createDeliveryPartner(body: {
    email?: string;
    login_id?: string;
    full_name: string;
    employee_code?: string;
    vehicle_type?: string;
    vehicle_number?: string;
  }): Promise<DeliveryPartnerDto & { password_setup_link: string }> {
    return this.request('/v1/admin/delivery-partners', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  suspendDeliveryPartner(id: string): Promise<DeliveryPartnerDto> {
    return this.request(`/v1/admin/delivery-partners/${id}/suspend`, { method: 'POST' });
  }

  reactivateDeliveryPartner(id: string): Promise<DeliveryPartnerDto> {
    return this.request(`/v1/admin/delivery-partners/${id}/reactivate`, { method: 'POST' });
  }

  assignOrder(
    orderId: string,
    body: { partner_admin_user_id: string; reason?: string },
  ): Promise<AdminOrderDto> {
    return this.request(`/v1/admin/orders/${orderId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  getOrderAssignmentHistory(orderId: string): Promise<{ data: AssignmentHistoryEntryDto[] }> {
    return this.request(`/v1/admin/orders/${orderId}/assignment-history`);
  }

  // ── Admin: founder dashboard (Stage D) ───────────────────────────────────

  getDashboardSummary(params: { from: string; to: string }): Promise<DashboardSummary> {
    return this.request(`/v1/admin/dashboard/summary${this.query(params)}`);
  }

  getSalesTrend(params: { from: string; to: string }): Promise<SalesTrendResponse> {
    return this.request(`/v1/admin/dashboard/sales-trend${this.query(params)}`);
  }

  getTopProducts(params: {
    from: string;
    to: string;
    limit?: number;
  }): Promise<TopProductsResponse> {
    return this.request(`/v1/admin/dashboard/top-products${this.query(params)}`);
  }

  getInventoryAlerts(params: { limit?: number } = {}): Promise<InventoryAlertsResponse> {
    return this.request(`/v1/admin/dashboard/inventory-alerts${this.query(params)}`);
  }

  // ── Delivery partner self-service (Phase 06) — same admin session, gated
  // by the `deliveries:fulfil` permission rather than a separate audience.

  deliveryMe(): Promise<DeliveryDashboardDto> {
    return this.request('/v1/admin/delivery/me');
  }

  setDeliveryDutyStatus(dutyStatus: 'ON_DUTY' | 'OFF_DUTY'): Promise<DeliveryDashboardDto> {
    return this.request('/v1/admin/delivery/duty', {
      method: 'POST',
      body: JSON.stringify({ duty_status: dutyStatus }),
    });
  }

  listMyDeliveries(
    params: PageParams & { status?: string } = {},
  ): Promise<DeliveryOrderListResponse> {
    return this.request(`/v1/admin/delivery/orders${this.query(params)}`);
  }

  getMyDelivery(id: string): Promise<DeliveryOrderDto> {
    return this.request(`/v1/admin/delivery/orders/${id}`);
  }

  acceptDelivery(id: string): Promise<DeliveryOrderDto> {
    return this.request(`/v1/admin/delivery/orders/${id}/accept`, { method: 'POST' });
  }

  markDeliveryDelivered(id: string): Promise<DeliveryOrderDto> {
    return this.request(`/v1/admin/delivery/orders/${id}/delivered`, { method: 'POST' });
  }

  markDeliveryFailed(id: string, reason: string): Promise<DeliveryOrderDto> {
    return this.request(`/v1/admin/delivery/orders/${id}/failed`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  recordDeliveryCodCollection(id: string, amountPaise: number): Promise<DeliveryOrderDto> {
    return this.request(`/v1/admin/delivery/orders/${id}/cod-collection`, {
      method: 'POST',
      body: JSON.stringify({ amount_paise: amountPaise }),
    });
  }

  // ── Admin: catalogue management (Phase 04B) ──────────────────────────────

  listAdminCategories(
    params: PageParams & { q?: string; is_active?: boolean } = {},
  ): Promise<AdminCategoryListResponse> {
    const { is_active, ...rest } = params;
    return this.request(
      `/v1/admin/categories${this.query({ ...rest, is_active: is_active === undefined ? undefined : String(is_active) })}`,
    );
  }

  getAdminCategory(id: string): Promise<AdminCategoryDto> {
    return this.request(`/v1/admin/categories/${id}`);
  }

  createCategory(body: {
    name: string;
    slug: string;
    description?: string;
    image_url?: string;
    display_order?: number;
  }): Promise<AdminCategoryDto> {
    return this.request('/v1/admin/categories', { method: 'POST', body: JSON.stringify(body) });
  }

  updateCategory(
    id: string,
    body: Partial<{
      name: string;
      description: string | null;
      image_url: string | null;
      display_order: number;
      is_active: boolean;
    }>,
  ): Promise<AdminCategoryDto> {
    return this.request(`/v1/admin/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  deleteCategory(id: string): Promise<void> {
    return this.request(`/v1/admin/categories/${id}`, { method: 'DELETE' });
  }

  listAdminProducts(
    params: PageParams & { q?: string; category_id?: string; status?: string } = {},
  ): Promise<AdminProductListResponse> {
    return this.request(`/v1/admin/products${this.query(params)}`);
  }

  getAdminProduct(id: string): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}`);
  }

  createProduct(body: {
    name: string;
    slug: string;
    category_id: string;
    short_description?: string;
    description?: string;
    ingredients?: string;
    allergens?: string[];
    dietary_tags?: string[];
  }): Promise<AdminProductDto> {
    return this.request('/v1/admin/products', { method: 'POST', body: JSON.stringify(body) });
  }

  updateProduct(
    id: string,
    body: Partial<{
      name: string;
      category_id: string;
      short_description: string | null;
      description: string | null;
      ingredients: string | null;
      allergens: string[];
      dietary_tags: string[];
      is_bestseller: boolean;
      is_new: boolean;
    }>,
  ): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  setProductStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
  ): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  addProductImage(
    id: string,
    body: { url: string; alt_text?: string; display_order?: number },
  ): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}/images`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  removeProductImage(id: string, imageId: string): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}/images/${imageId}`, { method: 'DELETE' });
  }

  /**
   * Step 1 of the device-upload flow: returns a short-lived presigned PUT
   * URL. The caller uploads the file bytes directly to `upload_url` (a
   * plain `fetch(upload_url, { method: 'PUT', body: file, headers: {
   * 'Content-Type': file.type } })`, NOT through this SDK/API — object
   * storage credentials never touch this server), then calls
   * `confirmProductImageUpload`.
   */
  requestProductImageUpload(
    id: string,
    body: { content_type: string; display_order?: number },
  ): Promise<{ image_id: string; upload_url: string; expires_at: string; max_bytes: number }> {
    return this.request(`/v1/admin/products/${id}/images/upload-url`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Step 2: call once the direct upload to `upload_url` finishes (2xx response). */
  confirmProductImageUpload(id: string, imageId: string): Promise<AdminProductDto> {
    return this.request(`/v1/admin/products/${id}/images/${imageId}/confirm`, { method: 'POST' });
  }

  createVariant(
    productId: string,
    body: {
      sku: string;
      name: string;
      unit: string;
      unit_value: number;
      mrp_paise?: number;
      price_paise: number;
      is_default?: boolean;
      max_order_quantity?: number;
      initial_quantity_on_hand?: number;
    },
  ): Promise<AdminVariantDto> {
    return this.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  updateVariant(
    id: string,
    body: Partial<{
      name: string;
      unit: string;
      unit_value: number;
      mrp_paise: number | null;
      price_paise: number;
      availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'DISCONTINUED';
      is_default: boolean;
      max_order_quantity: number | null;
    }>,
  ): Promise<AdminVariantDto> {
    return this.request(`/v1/admin/variants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  setVariantStock(
    id: string,
    body: {
      quantity_on_hand: number;
      low_stock_threshold?: number;
      allow_backorder?: boolean;
      note?: string;
    },
  ): Promise<AdminVariantDto> {
    return this.request(`/v1/admin/variants/${id}/stock`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── Admin: delivery-slot management (Phase 04) ───────────────────────────

  listAdminDeliverySlots(): Promise<AdminDeliverySlotListResponse> {
    return this.request('/v1/admin/delivery-slots');
  }

  getAdminDeliverySlot(id: string): Promise<AdminDeliverySlotDto> {
    return this.request(`/v1/admin/delivery-slots/${id}`);
  }

  createDeliverySlot(body: {
    name: string;
    code: string;
    start_time: string;
    end_time: string;
    cutoff_time?: string;
    cutoff_days_before?: number;
    available_days: number[];
    default_capacity: number;
    delivery_fee_paise?: number;
    min_order_value_paise?: number;
    display_order?: number;
  }): Promise<AdminDeliverySlotDto> {
    return this.request('/v1/admin/delivery-slots', { method: 'POST', body: JSON.stringify(body) });
  }

  updateDeliverySlot(
    id: string,
    body: Partial<{
      name: string;
      start_time: string;
      end_time: string;
      cutoff_time: string;
      cutoff_days_before: number;
      available_days: number[];
      default_capacity: number;
      delivery_fee_paise: number | null;
      min_order_value_paise: number | null;
      display_order: number;
      is_active: boolean;
    }>,
  ): Promise<AdminDeliverySlotDto> {
    return this.request(`/v1/admin/delivery-slots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // ── Admin: staff / employees (Phase 05) ──────────────────────────────────

  listAdminUsers(params: { q?: string } = {}): Promise<{ data: AdminUser[] }> {
    return this.request(`/v1/admin/admin-users${this.query(params)}`);
  }

  getAdminUser(id: string): Promise<AdminUser> {
    return this.request(`/v1/admin/admin-users/${id}`);
  }

  inviteAdminUser(body: {
    email?: string;
    login_id?: string;
    full_name: string;
    designation?: string;
    department?: string;
    role_ids: string[];
    password_setup_continue_url?: string;
  }): Promise<AdminUser & { password_setup_link: string }> {
    return this.request('/v1/admin/admin-users', { method: 'POST', body: JSON.stringify(body) });
  }

  updateAdminUser(
    id: string,
    body: { full_name?: string; designation?: string; department?: string },
  ): Promise<AdminUser> {
    return this.request(`/v1/admin/admin-users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  setAdminUserRoles(id: string, roleIds: string[]): Promise<AdminUser> {
    return this.request(`/v1/admin/admin-users/${id}/roles`, {
      method: 'POST',
      body: JSON.stringify({ role_ids: roleIds }),
    });
  }

  resetAdminUserPassword(
    id: string,
    body: { password_setup_continue_url?: string } = {},
  ): Promise<{ password_setup_link: string }> {
    return this.request(`/v1/admin/admin-users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  deactivateAdminUser(id: string): Promise<AdminUser> {
    return this.request(`/v1/admin/admin-users/${id}/deactivate`, { method: 'POST' });
  }

  reactivateAdminUser(id: string): Promise<AdminUser> {
    return this.request(`/v1/admin/admin-users/${id}/reactivate`, { method: 'POST' });
  }

  // ── Admin: roles & permissions (Phase 05) ────────────────────────────────

  listRoles(): Promise<{ data: Role[] }> {
    return this.request('/v1/admin/roles');
  }

  listPermissions(): Promise<{ data: Permission[] }> {
    return this.request('/v1/admin/permissions');
  }

  createRole(body: {
    key: string;
    name: string;
    description?: string;
    permission_keys: string[];
  }): Promise<Role> {
    return this.request('/v1/admin/roles', { method: 'POST', body: JSON.stringify(body) });
  }

  updateRolePermissions(id: string, permissionKeys: string[]): Promise<Role> {
    return this.request(`/v1/admin/roles/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permission_keys: permissionKeys }),
    });
  }

  // ── Admin: audit log (Phase 05) ───────────────────────────────────────────

  listAuditLog(
    params: {
      cursor?: string;
      limit?: number;
      actor_user_id?: string;
      action?: string;
      resource_type?: string;
    } = {},
  ): Promise<{
    data: AuditLogEntry[];
    pagination: { limit: number; next_cursor: string | null; has_more: boolean };
  }> {
    return this.request(`/v1/admin/audit-log${this.query(params)}`);
  }
}

export type {
  AddressDto,
  AddressListResponse,
  AdminCategoryDto,
  AdminCategoryListResponse,
  AdminDeliverySlotDto,
  AdminDeliverySlotListResponse,
  AdminMe,
  AdminOrderDto,
  AdminOrderListResponse,
  AdminProductDto,
  AdminProductListResponse,
  AdminVariantDto,
  AdminUser,
  AuditLogEntry,
  CartDto,
  CartItemDto,
  CategoryDto,
  CityListResponse,
  CityPublic,
  CustomerSessionResponse,
  DashboardSummary,
  DeliveryDashboardDto,
  DeliveryOrderDto,
  DeliveryOrderListResponse,
  DeliveryPartnerDto,
  DeliveryPartnerListResponse,
  DeliverySlotDto,
  DeliverySlotListResponse,
  AssignmentHistoryEntryDto,
  InventoryAlertsResponse,
  OrderDto,
  OrderItemDto,
  OrderListResponse,
  Permission,
  PincodeListResponse,
  ProductDetailDto,
  ProductListResponse,
  ProductSummaryDto,
  ProductVariantDto,
  Role,
  SalesTrendResponse,
  ServiceabilityResponse,
  TopProductsResponse,
} from '@healthy-aahar/contracts';
