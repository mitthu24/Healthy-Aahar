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
    throw new Error(
      `Firebase ${audience} project requires a service account outside the emulator. ` +
        `Set FIREBASE_${audience.toUpperCase()}_SERVICE_ACCOUNT_B64.`,
    );
  }

  const serviceAccount = decodeServiceAccount(config.serviceAccountB64);

  if (serviceAccount.project_id !== config.projectId) {
    // Catches the copy-paste error of pointing the admin verifier at the
    // customer project's credentials, which would silently collapse the
    // audience separation this design depends on.
    throw new Error(
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
  private readonly auth: Auth;

  constructor(
    readonly audience: FirebaseAudience,
    private readonly config: FirebaseProjectConfig,
  ) {
    this.auth = getAuth(getOrCreateApp(audience, config));
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
