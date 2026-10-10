// ── Domain: pure, no I/O, no framework ──────────────────────────────────
export * from './domain/money.js';
export * from './domain/time.js';
export * from './domain/ids.js';
export * from './domain/errors.js';
export * from './domain/serviceability.js';
export * from './domain/pagination.js';
export * from './domain/business-scope.js';
export * from './domain/order-status.js';
export * from './domain/permissions.js';

// ── Ports: interfaces the application depends on ────────────────────────
export type { ServiceabilityRepository } from './ports/serviceability-repository.js';
export type {
  CityRow,
  PincodeRow,
  CityRepository,
  PincodeRepository,
  CityListFilter,
  PincodeListFilter,
  CreateCityInput,
  UpdateCityInput,
  CreatePincodeInput,
  UpdatePincodeInput,
} from './ports/serviceability-admin-repository.js';
export type {
  UserType,
  AccountStatus,
  UserRow,
  CustomerProfileRow,
  CreateCustomerWithPasswordInput,
  CreateCustomerWithPasswordResult,
  UserRepository,
} from './ports/user-repository.js';
export type {
  AdminUserRow,
  EffectivePermissions,
  InviteAdminInput,
  InviteAdminResult,
  AdminRepository,
  RoleRow,
  RoleRepository,
} from './ports/admin-repository.js';
export type { PasswordHasher } from './ports/password-hasher.js';
export type { SessionTokenHasher } from './ports/session-token-hasher.js';
export type {
  SessionRow,
  CreateSessionInput,
  SessionRepository,
} from './ports/session-repository.js';
export type {
  PasswordResetPurpose,
  PasswordResetTokenRow,
  CreatePasswordResetTokenInput,
  PasswordResetRepository,
} from './ports/password-reset-repository.js';
export type { AuditEvent, AuditLogRepository } from './ports/audit-log-repository.js';
export type { AddressInput, AddressRow, AddressRepository } from './ports/address-repository.js';
export type {
  CategoryRow,
  VariantRow,
  ProductSummaryRow,
  ProductDetailRow,
  ListProductsFilter,
  CatalogueRepository,
} from './ports/catalogue-repository.js';
export type { CartItemRow, CartRow, CartRepository } from './ports/cart-repository.js';
export type { PlaceOrderInput, CheckoutRepository } from './ports/checkout-repository.js';
export type {
  OrderItemRow,
  OrderAddressSnapshot,
  OrderRow,
  OrderListFilter,
  TransitionInput,
  OrderRepository,
} from './ports/order-repository.js';
export type {
  AdminCategoryRow,
  CategoryInput,
  CategoryUpdateInput,
  CategoryListFilter,
  AdminCategoryRepository,
  AdminVariantInventoryRow,
  AdminVariantRow,
  VariantInput,
  VariantUpdateInput,
  AdminVariantRepository,
  AdminProductImageRow,
  AdminProductRow,
  AdminProductSummaryRow,
  ProductInput,
  ProductUpdateInput,
  ProductListFilter,
  AdminProductRepository,
} from './ports/admin-catalogue-repository.js';

// ── Application services ────────────────────────────────────────────────
export {
  ServiceabilityService,
  type ServiceabilityServiceDeps,
} from './services/serviceability-service.js';
export {
  ServiceabilityAdminService,
  type ServiceabilityAdminDeps,
} from './services/serviceability-admin-service.js';
export {
  CustomerAuthService,
  type CustomerActor,
  type CustomerAuthResult,
  type RegisterParams as CustomerRegisterParams,
  type LoginParams as CustomerLoginParams,
} from './services/customer-auth-service.js';
export {
  AdminAuthService,
  type AdminActor,
  type AdminLoginParams,
  type AdminLoginResult,
} from './services/admin-auth-service.js';
export { RbacService } from './services/rbac-service.js';
export { PasswordResetService } from './services/password-reset-service.js';
export { validateSession, type ValidatedSession } from './services/session-validation.js';
export { AddressService, type AddressServiceDeps } from './services/address-service.js';
export { CatalogueService, type CatalogueServiceDeps } from './services/catalogue-service.js';
export {
  CartService,
  type CartServiceDeps,
  type CartView,
  type CartIssue,
} from './services/cart-service.js';
export { CheckoutService, type CheckoutServiceDeps } from './services/checkout-service.js';
export {
  CustomerOrderService,
  type CustomerOrderServiceDeps,
} from './services/customer-order-service.js';
export {
  OrderFulfilmentService,
  type OrderFulfilmentServiceDeps,
} from './services/order-fulfilment-service.js';
export { toOrderView, toAdminOrderView } from './services/order-view.js';
export {
  AdminCatalogueService,
  type AdminCatalogueServiceDeps,
} from './services/admin-catalogue-service.js';
export {
  toAdminCategoryView,
  toAdminVariantView,
  toAdminProductView,
  toAdminProductSummaryView,
} from './services/admin-catalogue-view.js';
