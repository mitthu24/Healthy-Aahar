/**
 * The slice of Firebase admin-user management that `RbacService` needs.
 *
 * Declared here (not imported from `@healthy-aahar/auth`) so `core` has no
 * dependency on `auth` — the dependency runs the other way (`auth` sits
 * below `core` in nothing; `apps/api` wires the two together). This is the
 * same seam that makes the service testable without Firebase: a fake
 * implementing this three-method interface exercises the full invite /
 * deactivate flow deterministically.
 */
export interface AdminIdentityProvider {
  createUser(params: { email: string; password: string; displayName?: string }): Promise<string>;
  disableUser(uid: string): Promise<void>;
  generatePasswordResetLink(email: string, continueUrl?: string): Promise<string>;
}
