import {
  newId,
  now,
  type CreatePasswordResetTokenInput,
  type PasswordResetRepository,
  type PasswordResetTokenRow,
} from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

/** Prisma implementation of one-time password setup/reset tokens (PHASE 03, docs/07 §5.1). */
export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePasswordResetTokenInput): Promise<void> {
    await this.prisma.passwordResetToken.create({
      data: {
        id: newId(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      },
    });
  }

  async consume(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const at = now();

    // The conditional WHERE (unused, unexpired) is the entire authorization
    // check — not a separate read beforehand. `updateMany`'s `count` tells
    // us whether WE won the race: 0 means another request already consumed
    // it (or it never existed, or it had expired), 1 means we are the
    // exclusive, atomic claimant. A plain Prisma `update` would throw on no
    // match instead of reporting a count, which is why this uses
    // `updateMany` against a `tokenHash` that is already unique by schema.
    const result = await this.prisma.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: at } },
      data: { usedAt: at },
    });

    if (result.count === 0) return null;

    // Safe to read back without a race: only the transaction that just
    // incremented `count` to 1 above can have done so for this
    // `tokenHash` (it is unique), so this row is now ours alone.
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      purpose: row.purpose,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
    };
  }
}
