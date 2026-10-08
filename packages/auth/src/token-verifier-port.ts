/**
 * The shape every consumer of token verification depends on.
 *
 * `FirebaseTokenVerifier` (firebase.ts) implements this against real Firebase
 * projects (or the Firebase Auth emulator). Tests implement it with an
 * in-memory fake so the entire session-exchange / RBAC / business-isolation
 * pipeline is exercised without a live Firebase project — the seam that
 * cannot be tested without one is narrow and isolated to this port's
 * Firebase-backed implementation.
 */
export type VerifiedIdentity = {
  uid: string;
  phoneNumber?: string;
  email?: string;
  emailVerified?: boolean;
  /** Firebase `auth_time` (seconds since epoch) — when the credential was presented. */
  authTime: number;
};

export interface TokenVerifierPort {
  verify(idToken: string): Promise<VerifiedIdentity>;
}
