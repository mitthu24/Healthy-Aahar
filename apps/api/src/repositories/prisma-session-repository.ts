import { newId, now, type CreateSessionInput, type SessionRepository, type SessionRow } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

/** Prisma implementation of DB-backed sessions (PHASE 03, docs/07 §5). */
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const created = await this.prisma.session.create({
      data: {
        id: newId(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return toSessionRow(created);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const found = await this.prisma.session.findUnique({ where: { tokenHash } });
    return found ? toSessionRow(found) : null;
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: at } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: now() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now() },
    });
  }
}

function toSessionRow(raw: {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}): SessionRow {
  return {
    id: raw.id,
    userId: raw.userId,
    expiresAt: raw.expiresAt,
    lastSeenAt: raw.lastSeenAt,
    revokedAt: raw.revokedAt,
  };
}
