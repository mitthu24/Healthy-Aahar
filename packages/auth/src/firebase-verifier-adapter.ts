import { FirebaseTokenVerifier, type FirebaseAudience, type FirebaseProjectConfig } from './firebase.js';
import type { TokenVerifierPort, VerifiedIdentity } from './token-verifier-port.js';

/**
 * Adapts `FirebaseTokenVerifier` (raw `DecodedIdToken`) to `TokenVerifierPort`
 * (the narrow shape services depend on). Services and middleware never import
 * `firebase-admin` types directly — only this port — so a fake can stand in
 * for tests without a live Firebase project.
 */
export class FirebaseVerifierAdapter implements TokenVerifierPort {
  private readonly verifier: FirebaseTokenVerifier;

  constructor(audience: FirebaseAudience, config: FirebaseProjectConfig) {
    this.verifier = new FirebaseTokenVerifier(audience, config);
  }

  async verify(idToken: string): Promise<VerifiedIdentity> {
    const decoded = await this.verifier.verify(idToken);
    return {
      uid: decoded.uid,
      phoneNumber: decoded.phone_number,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      authTime: decoded.auth_time,
    };
  }
}
