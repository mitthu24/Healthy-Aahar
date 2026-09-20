// Domain — pure, no I/O
export * from './domain/money.js';
export * from './domain/time.js';
export * from './domain/ids.js';
export * from './domain/errors.js';
export * from './domain/serviceability.js';

// Ports — interfaces the application depends on
export type { ServiceabilityRepository } from './ports/serviceability-repository.js';

// Application services
export {
  ServiceabilityService,
  type ServiceabilityServiceDeps,
} from './services/serviceability-service.js';
