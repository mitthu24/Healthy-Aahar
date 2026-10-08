import {
  newId,
  now,
  type AccountStatus,
  type BusinessScope,
  type CreateCustomerInput,
  type CustomerProfileRow,
  type UserRepository,
  type UserRow,
  type UserType,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementation of identity persistence (docs/07 §3).
 *
 * `createCustomer` is transactional and idempotent under concurrency: the
 * unique index on `(firebase_uid, user_type)` means a race between two
 * "first sign-in" requests resolves to exactly one row, and the loser
 * re-reads rather than surfacing a raw constraint violation to the caller.
 */

const USER_SELECT = {
  id: true,
  firebaseUid: true,
  userType: true,
  email: true,
  phone: true,
  emailVerified: true,
  phoneVerified: true,
  status: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

type RawUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserRow(raw: RawUser): UserRow {
  return {
    id: raw.id,
    firebaseUid: raw.firebaseUid,
    userType: raw.userType as UserType,
    email: raw.email,
    phone: raw.phone,
    emailVerified: raw.emailVerified,
    phoneVerified: raw.phoneVerified,
    status: raw.status as AccountStatus,
    lastLoginAt: raw.lastLoginAt,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByFirebaseUid(firebaseUid: string, userType: UserType): Promise<UserRow | null> {
    const raw = await this.prisma.user.findUnique({
      where: { firebaseUid_userType: { firebaseUid, userType } },
      select: USER_SELECT,
    });
    return raw ? toUserRow(raw) : null;
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: now() } });
  }

  async createCustomer(
    scope: BusinessScope,
    input: CreateCustomerInput,
  ): Promise<{ user: UserRow; profile: CustomerProfileRow; created: boolean }> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const userId = newId();
        const profileId = newId();

        const user = await tx.user.create({
          data: {
            id: userId,
            firebaseUid: input.firebaseUid,
            userType: 'CUSTOMER',
            phone: input.phone ?? null,
            email: input.email ?? null,
            phoneVerified: input.phoneVerified ?? false,
            emailVerified: input.emailVerified ?? false,
            status: 'ACTIVE',
            lastLoginAt: now(),
          },
          select: USER_SELECT,
        });

        const profile = await tx.customerProfile.create({
          data: { id: profileId, businessId: scope, userId },
        });

        await tx.notificationOutbox.create({
          data: {
            id: newId(),
            businessId: scope,
            eventType: 'CUSTOMER_REGISTERED',
            aggregateType: 'customer_profile',
            aggregateId: profileId,
            payload: { userId, phone: input.phone ?? null, email: input.email ?? null },
          },
        });

        return { user, profile };
      });

      return {
        user: toUserRow(result.user),
        profile: {
          id: result.profile.id,
          businessId: result.profile.businessId,
          userId: result.profile.userId,
          firstName: result.profile.firstName,
          lastName: result.profile.lastName,
          displayName: result.profile.displayName,
        },
        created: true,
      };
    } catch (error) {
      // P2002 = unique constraint violation on (firebase_uid, user_type):
      // a concurrent request won the race. Re-read rather than fail.
      if ((error as { code?: string }).code === 'P2002') {
        const existing = await this.findByFirebaseUid(input.firebaseUid, 'CUSTOMER');
        const profile = existing ? await this.findCustomerProfile(existing.id) : null;
        if (existing && profile) {
          return { user: existing, profile, created: false };
        }
      }
      throw error;
    }
  }

  async findCustomerProfile(userId: string): Promise<CustomerProfileRow | null> {
    const raw = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!raw) return null;
    return {
      id: raw.id,
      businessId: raw.businessId,
      userId: raw.userId,
      firstName: raw.firstName,
      lastName: raw.lastName,
      displayName: raw.displayName,
    };
  }
}
