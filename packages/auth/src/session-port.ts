import { FirebaseTokenVerifier, type FirebaseProjectConfig } from './firebase.js';
import type { VerifiedIdentity } from './token-verifier-port.js';

/**
 * The admin session-cookie lifecycle, narrowed to what services depend on.
 * Firebase-backed in production; fakeable in tests for the same reason as
 * `TokenVerifierPort` (token-verifier-port.ts).
 */
export interface AdminSessionPort {
  /** Exchanges a fresh admin ID token for a session cookie value. */
  createSessionCookie(idToken: string, expiresInMs: number): Promise<string>;
  /** Verifies a previously issued session cookie. */
  verifySessionCookie(cookie: string): Promise<VerifiedIdentity>;
  /** BR-SEC10 — ends every session for this Firebase user immediately. */
  revokeRefreshTokens(uid: string): Promise<void>;
  createUser(params: { email: string; password: string; displayName?: string }): Promise<string>;
  disableUser(uid: string): Promise<void>;
  generatePasswordResetLink(email: string, continueUrl?: string): Promise<string>;
}

export class FirebaseAdminSessionAdapter implements AdminSessionPort {
  private readonly verifier: FirebaseTokenVerifier;

  constructor(config: FirebaseProjectConfig) {
    this.verifier = new FirebaseTokenVerifier('admin', config);
  }

  createSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
    return this.verifier.createSessionCookie(idToken, expiresInMs);
  }

  async verifySessionCookie(cookie: string): Promise<VerifiedIdentity> {
    const decoded = await this.verifier.verifySessionCookie(cookie);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      authTime: decoded.auth_time,
    };
  }

  revokeRefreshTokens(uid: string): Promise<void> {
    return this.verifier.revokeRefreshTokens(uid);
  }

  createUser(params: { email: string; password: string; displayName?: string }): Promise<string> {
    return this.verifier.createUser(params);
  }

  disableUser(uid: string): Promise<void> {
    return this.verifier.disableUser(uid);
  }

  generatePasswordResetLink(email: string, continueUrl?: string): Promise<string> {
    return this.verifier.generatePasswordResetLink(email, continueUrl);
  }
}
