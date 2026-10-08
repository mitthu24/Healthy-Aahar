import { TokenVerificationError, type AdminSessionPort, type TokenVerifierPort, type VerifiedIdentity } from '@healthy-aahar/auth';

/**
 * In-memory fakes for `TokenVerifierPort` and `AdminSessionPort`.
 *
 * This is the seam documented in `token-verifier-port.ts` / `session-port.ts`:
 * every consumer (middleware, routes, services) depends on the port, never on
 * `firebase-admin` directly, so the ENTIRE session-exchange / RBAC /
 * business-isolation pipeline can be exercised deterministically and without
 * network access — no Firebase project, no emulator process, no flakiness.
 *
 * What this does NOT test: that `firebase-admin`'s `verifyIdToken` /
 * `createSessionCookie` / `verifySessionCookie` behave as documented against
 * a real Firebase project. That seam is `packages/auth/src/firebase.ts`,
 * which is thin (delegates straight to the SDK) and is exercised manually
 * against the Firebase Auth emulator — see PHASE-03-IMPLEMENTATION-REPORT.md
 * "Known limitations" for why that is not wired into the automated suite.
 */

/** A fake "issued" token is just a JSON-encoded identity — never a real JWT. */
export function fakeToken(identity: Omit<VerifiedIdentity, 'authTime'> & { authTime?: number }): string {
  return JSON.stringify({ authTime: Math.floor(Date.now() / 1000), ...identity });
}

export class FakeTokenVerifier implements TokenVerifierPort {
  /** Uids present here are treated as "revoked" — verify() rejects them. */
  readonly revoked = new Set<string>();

  async verify(idToken: string): Promise<VerifiedIdentity> {
    let parsed: VerifiedIdentity;
    try {
      parsed = JSON.parse(idToken) as VerifiedIdentity;
    } catch {
      throw makeVerificationError('INVALID', 'Malformed fake token');
    }
    if (parsed.uid === '__EXPIRED__') throw makeVerificationError('EXPIRED', 'Token has expired');
    if (this.revoked.has(parsed.uid)) throw makeVerificationError('REVOKED', 'Token has been revoked');
    return parsed;
  }
}

export class FakeAdminSession implements AdminSessionPort {
  readonly revoked = new Set<string>();
  readonly disabled = new Set<string>();
  private readonly cookies = new Map<string, VerifiedIdentity>();
  private counter = 0;

  async createSessionCookie(idToken: string): Promise<string> {
    const identity = JSON.parse(idToken) as VerifiedIdentity;
    const cookie = `fake-session-${(this.counter += 1)}`;
    this.cookies.set(cookie, identity);
    return cookie;
  }

  async verifySessionCookie(cookie: string): Promise<VerifiedIdentity> {
    const identity = this.cookies.get(cookie);
    if (!identity) throw makeVerificationError('INVALID', 'Unknown session cookie');
    if (this.revoked.has(identity.uid)) throw makeVerificationError('REVOKED', 'Session has been revoked');
    return identity;
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    this.revoked.add(uid);
  }

  async createUser(params: { email: string }): Promise<string> {
    return `fake-created-${params.email}`;
  }

  async disableUser(uid: string): Promise<void> {
    this.disabled.add(uid);
    this.revoked.add(uid);
  }

  async generatePasswordResetLink(email: string): Promise<string> {
    return `https://example.test/reset?email=${encodeURIComponent(email)}`;
  }
}

/**
 * Throws the REAL `TokenVerificationError` (not a lookalike) — middleware
 * checks `error instanceof TokenVerificationError`, and importing that one
 * class is the only coupling to `packages/auth` this file needs; it does
 * not pull in `firebase-admin` itself.
 */
function makeVerificationError(
  reason: 'EXPIRED' | 'INVALID' | 'WRONG_AUDIENCE' | 'REVOKED',
  message: string,
): TokenVerificationError {
  return new TokenVerificationError(reason, message);
}
