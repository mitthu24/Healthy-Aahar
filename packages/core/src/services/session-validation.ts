import { DomainError } from '../domain/errors.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionTokenHasher } from '../ports/session-token-hasher.js';

export type ValidatedSession = { userId: string; sessionId: string };

/**
 * Shared by `AdminAuthService` and `CustomerAuthService` (PHASE 03, docs/07
 * §5–§6) — the two differ only in WHERE the raw token comes from (cookie vs
 * `Authorization: Bearer`) and whether an idle timeout applies; the
 * validation rules themselves (exists, not revoked, not expired, idle
 * timeout) are identical and must not drift between the two audiences.
 *
 * Throws `SESSION_EXPIRED` for every failure mode except "no such session"
 * (`UNAUTHENTICATED`) — a revoked, expired or idle-timed-out session is a
 * session that DID exist, which is a materially different signal for
 * clients (and logs) than a token that was never valid at all.
 */
export async function validateSession(
  sessions: SessionRepository,
  tokenHasher: SessionTokenHasher,
  rawToken: string,
  options: { idleTimeoutMs?: number } = {},
): Promise<ValidatedSession> {
  const tokenHash = tokenHasher.hash(rawToken);
  const session = await sessions.findByTokenHash(tokenHash);

  if (!session) {
    throw new DomainError('UNAUTHENTICATED', 'No session.');
  }
  if (session.revokedAt) {
    throw new DomainError('SESSION_EXPIRED', 'Session has been revoked.');
  }

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    throw new DomainError('SESSION_EXPIRED', 'Session has expired. Sign in again.');
  }
  if (options.idleTimeoutMs && now - session.lastSeenAt.getTime() > options.idleTimeoutMs) {
    throw new DomainError('SESSION_EXPIRED', 'Session has been idle too long. Sign in again.');
  }

  // Throttled write: only bump `last_seen_at` if more than 60s have passed,
  // so a hot endpoint does not turn every authenticated request into a
  // session UPDATE. 60s is well under any idle timeout this system
  // configures (minimum 30 minutes), so it never affects the timeout's
  // accuracy in practice.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await sessions.touch(session.id, new Date(now));
  }

  return { userId: session.userId, sessionId: session.id };
}
