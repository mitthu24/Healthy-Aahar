export {
  FirebaseTokenVerifier,
  TokenVerificationError,
  FirebaseConfigurationError,
  type FirebaseAudience,
  type FirebaseProjectConfig,
  type DecodedIdToken,
} from './firebase.js';

export type { TokenVerifierPort, VerifiedIdentity } from './token-verifier-port.js';
export { FirebaseVerifierAdapter } from './firebase-verifier-adapter.js';

export type { AdminSessionPort } from './session-port.js';
export { FirebaseAdminSessionAdapter } from './session-port.js';

export { PermissionCache, type EffectivePermissions } from './permission-cache.js';

export { CSRF_HEADER, CSRF_COOKIE, generateCsrfToken, verifyCsrfToken } from './csrf.js';
