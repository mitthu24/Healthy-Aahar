import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';

/**
 * Firebase token verification.
 *
 * Two SEPARATE projects, one per audience (ADR-010). This is the security
 * boundary that makes privilege escalation impossible rather than merely
 * unlikely: `verifyIdToken` checks the token's audience against the project it
 * was initialised with, so a customer token presented to the admin verifier
 * fails signature/audience validation before any application code runs.
 *
 * PHASE 01 provides verification only. Session exchange, the `Actor` model and
 * permission resolution land in PHASE 03.
 */

export type FirebaseAudience = 'customer' | 'admin';

export type FirebaseProjectConfig = {
  projectId: string;
  /** Base64-encoded service-account JSON. Never a file path, never committed. */
  serviceAccountB64?: string;
  /** Set only in local development. The env schema rejects it in production. */
  emulatorHost?: string;
};

export class TokenVerificationError extends Error {
  constructor(
    readonly reason: 'EXPIRED' | 'INVALID' | 'WRONG_AUDIENCE' | 'REVOKED',
    message: string,
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/**
 * Distinct from `TokenVerificationError`: this is not a bad TOKEN, it is a
 * missing or broken Firebase PROJECT credential (env misconfiguration).
 * Middleware maps it to 503, not 401 — the caller did nothing wrong.
 */
export class FirebaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseConfigurationError';
  }
}

function decodeServiceAccount(b64: string): Record<string, string> {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, string>;
  } catch {
    // Never echo the value — it is a private key.
    throw new Error('Service account is not valid base64-encoded JSON');
  }
}

function appNameFor(audience: FirebaseAudience): string {
  return `healthy-aahar-${audience}`;
}

function getOrCreateApp(audience: FirebaseAudience, config: FirebaseProjectConfig): App {
  const name = appNameFor(audience);
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;

  if (config.emulatorHost) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.emulatorHost;
    return initializeApp({ projectId: config.projectId }, name);
  }

  if (!config.serviceAccountB64) {
    throw new FirebaseConfigurationError(
      `Firebase ${audience} project requires a service account outside the emulator. ` +
        `Set FIREBASE_${audience.toUpperCase()}_SERVICE_ACCOUNT_B64.`,
    );
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = decodeServiceAccount(config.serviceAccountB64);
  } catch (error) {
    throw new FirebaseConfigurationError((error as Error).message);
  }

  if (serviceAccount.project_id !== config.projectId) {
    // Catches the copy-paste error of pointing the admin verifier at the
    // customer project's credentials, which would silently collapse the
    // audience separation this design depends on.
    throw new FirebaseConfigurationError(
      `Firebase ${audience} service account belongs to project "${serviceAccount.project_id}" ` +
        `but the configured project is "${config.projectId}".`,
    );
  }

  return initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key?.replace(/\\n/g, '\n'),
      }),
      projectId: config.projectId,
    },
    name,
  );
}

export class FirebaseTokenVerifier {
  private authInstance: Auth | undefined;

  constructor(
    readonly audience: FirebaseAudience,
    private readonly config: FirebaseProjectConfig,
  ) {}

  /**
   * Lazy on purpose: constructing this class happens at app-boot time for
   * every deployed environment (`app.ts`), but a genuinely missing or
   * misconfigured Firebase credential should not be able to crash the
   * WHOLE API — health checks, public catalogue/serviceability endpoints
   * and everything unrelated to auth must keep serving. Initialisation is
   * therefore deferred to the first real use (`verify`,
   * `createSessionCookie`, …), where a configuration problem surfaces as a
   * clean `SERVICE_UNAVAILABLE`-shaped failure on the auth routes only,
   * not a boot-time crash loop of the entire process.
   */
  private get auth(): Auth {
    if (!this.authInstance) {
      this.authInstance = getAuth(getOrCreateApp(this.audience, this.config));
    }
    return this.authInstance;
  }

  /**
   * Create a Firebase session cookie from a fresh, short-lived ID token.
   * Admin-project only in practice — the customer app never uses cookies
   * (docs/07 §5.2) — but nothing here assumes the audience, so the type stays
   * general.
   */
  async createSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
    return this.auth.createSessionCookie(idToken, { expiresIn: expiresInMs });
  }

  /**
   * Verify a session cookie previously issued by `createSessionCookie`.
   * `checkRevoked: true` so that revoking refresh tokens on deactivation
   * (BR-SEC10) invalidates an already-issued cookie immediately rather than
   * waiting for its `Max-Age` to lapse.
   */
  async verifySessionCookie(cookie: string): Promise<DecodedIdToken> {
    try {
      return await this.auth.verifySessionCookie(cookie, true);
    } catch (error) {
      // A misconfigured PROJECT, not a bad session — must not be relabelled
      // as "invalid" (that would surface as 401, hiding a 503-shaped ops
      // problem behind a customer-facing auth error).
      if (error instanceof FirebaseConfigurationError) throw error;
      const code = (error as { code?: string }).code ?? '';
      if (code.includes('session-cookie-expired')) {
        throw new TokenVerificationError('EXPIRED', 'Session has expired');
      }
      if (code.includes('session-cookie-revoked')) {
        throw new TokenVerificationError('REVOKED', 'Session has been revoked');
      }
      throw new TokenVerificationError('INVALID', 'Session could not be verified');
    }
  }

  /** Revokes every refresh token for this Firebase user (BR-SEC10). */
  async revokeRefreshTokens(uid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(uid);
  }

  /**
   * Create a staff account with a random password and no public sign-up path
   * (docs/07 §5.1). Returns the new Firebase uid.
   */
  async createUser(params: { email: string; password: string; displayName?: string }): Promise<string> {
    const user = await this.auth.createUser({
      email: params.email,
      password: params.password,
      displayName: params.displayName,
      emailVerified: false,
    });
    return user.uid;
  }

  /** Disables sign-in and revokes tokens in one call — used on deactivation. */
  async disableUser(uid: string): Promise<void> {
    await this.auth.updateUser(uid, { disabled: true });
    await this.auth.revokeRefreshTokens(uid);
  }

  /** Password-reset link an invited admin uses to set their own password. */
  async generatePasswordResetLink(email: string, continueUrl?: string): Promise<string> {
    return this.auth.generatePasswordResetLink(email, continueUrl ? { url: continueUrl } : undefined);
  }

  /**
   * Verify an ID token issued by THIS project.
   *
   * `checkRevoked` is true for admins so that deactivating a staff account
   * ends their session immediately rather than up to an hour later
   * (BR-SEC10). Customers are checked against `users.status` in the API
   * instead, which is cheaper and equally immediate (BR-SEC3).
   */
  async verify(idToken: string): Promise<DecodedIdToken> {
    try {
      const decoded = await this.auth.verifyIdToken(idToken, this.audience === 'admin');

      // Defence in depth: the SDK already enforces this, but an explicit
      // check means a future misconfiguration cannot pass silently.
      if (decoded.aud !== this.config.projectId) {
        throw new TokenVerificationError(
          'WRONG_AUDIENCE',
          'Token was issued for a different Firebase project',
        );
      }

      return decoded;
    } catch (error) {
      if (error instanceof TokenVerificationError) throw error;
      if (error instanceof FirebaseConfigurationError) throw error;

      const code = (error as { code?: string }).code ?? '';

      if (code.includes('id-token-expired')) {
        throw new TokenVerificationError('EXPIRED', 'Token has expired');
      }
      if (code.includes('id-token-revoked')) {
        throw new TokenVerificationError('REVOKED', 'Token has been revoked');
      }
      throw new TokenVerificationError('INVALID', 'Token could not be verified');
    }
  }
}

export type { DecodedIdToken };
