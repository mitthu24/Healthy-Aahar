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
export type { SessionRow, CreateSessionInput, SessionRepository } from './ports/session-repository.js';
export type {
  PasswordResetPurpose,
  PasswordResetTokenRow,
  CreatePasswordResetTokenInput,
  PasswordResetRepository,
} from './ports/password-reset-repository.js';
export type { AuditEvent, AuditLogRepository } from './ports/audit-log-repository.js';

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
