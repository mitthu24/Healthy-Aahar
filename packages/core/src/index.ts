// ── Domain: pure, no I/O, no framework ──────────────────────────────────
export * from './domain/money.js';
export * from './domain/time.js';
export * from './domain/ids.js';
export * from './domain/errors.js';
export * from './domain/serviceability.js';
export * from './domain/pagination.js';
export * from './domain/business-scope.js';
export * from './domain/order-status.js';

// ── Ports: interfaces the application depends on ────────────────────────
export type { ServiceabilityRepository } from './ports/serviceability-repository.js';
export type {
  CityRepository,
  PincodeRepository,
  CityListFilter,
  PincodeListFilter,
  CreateCityInput,
  UpdateCityInput,
  CreatePincodeInput,
  UpdatePincodeInput,
} from './ports/serviceability-admin-repository.js';

// ── Application services ────────────────────────────────────────────────
export {
  ServiceabilityService,
  type ServiceabilityServiceDeps,
} from './services/serviceability-service.js';
export {
  ServiceabilityAdminService,
  type ServiceabilityAdminDeps,
} from './services/serviceability-admin-service.js';
