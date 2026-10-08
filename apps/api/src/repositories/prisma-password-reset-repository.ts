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

  async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const found = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!found) return null;
    return {
      id: found.id,
      userId: found.userId,
      purpose: found.purpose,
      expiresAt: found.expiresAt,
      usedAt: found.usedAt,
    };
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({ where: { id }, data: { usedAt: now() } });
  }
}
