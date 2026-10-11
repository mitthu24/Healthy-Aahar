/**
 * Server-side session persistence (PHASE 03, docs/07 §5). Declared here, not
 * in `@healthy-aahar/auth`, for the same reason as every other port in this
 * directory: `core` depends on nothing concrete, `apps/api` wires a Prisma
 * implementation in at the composition root.
 */
export type SessionRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRow>;
  findByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  /** Bumps `last_seen_at` — the idle-timeout clock (docs/07 §5.2). */
  touch(sessionId: string, at: Date): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  /** BR-SEC10 equivalent for DB-backed sessions: ends every session for a user at once (deactivation, password change). */
  revokeAllForUser(userId: string): Promise<void>;
}
