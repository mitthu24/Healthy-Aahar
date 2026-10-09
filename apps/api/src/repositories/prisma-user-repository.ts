import {
  newId,
  now,
  type AccountStatus,
  type BusinessScope,
  type CreateCustomerWithPasswordInput,
  type CreateCustomerWithPasswordResult,
  type CustomerProfileRow,
  type UserRepository,
  type UserRow,
  type UserType,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

import { isUniqueConstraintViolation } from './prisma-errors.js';

/**
 * Prisma implementation of identity persistence (docs/07 §3, PHASE 03
 * email/password).
 *
 * `createCustomerWithPassword` is transactional. Unlike the PHASE 01/02 OTP
 * "first sign-in" path, a duplicate email here is a genuine user error
 * (someone already registered with that address) rather than a legitimate
 * concurrent-request race, so it is surfaced as `{ ok: false }` rather than
 * silently merged into the existing row.
 */

const USER_SELECT = {
  id: true,
  firebaseUid: true,
  passwordHash: true,
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
    passwordHash: raw.passwordHash,
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

  async findById(id: string): Promise<UserRow | null> {
    const raw = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    return raw ? toUserRow(raw) : null;
  }

  async findByEmail(email: string, userType: UserType): Promise<UserRow | null> {
    const raw = await this.prisma.user.findUnique({
      where: { email_userType: { email, userType } },
      select: USER_SELECT,
    });
    return raw ? toUserRow(raw) : null;
  }

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

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async createCustomerWithPassword(
    scope: BusinessScope,
    input: CreateCustomerWithPasswordInput,
  ): Promise<CreateCustomerWithPasswordResult> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const userId = newId();
        const profileId = newId();

        const user = await tx.user.create({
          data: {
            id: userId,
            userType: 'CUSTOMER',
            email: input.email,
            passwordHash: input.passwordHash,
            phone: input.phone ?? null,
            emailVerified: false,
            phoneVerified: false,
            status: 'ACTIVE',
            lastLoginAt: now(),
          },
          select: USER_SELECT,
        });

        const profile = await tx.customerProfile.create({
          data: {
            id: profileId,
            businessId: scope,
            userId,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
          },
        });

        await tx.notificationOutbox.create({
          data: {
            id: newId(),
            businessId: scope,
            eventType: 'CUSTOMER_REGISTERED',
            aggregateType: 'customer_profile',
            aggregateId: profileId,
            payload: { userId, email: input.email, phone: input.phone ?? null },
          },
        });

        return { user, profile };
      });

      return {
        ok: true,
        user: toUserRow(result.user),
        profile: {
          id: result.profile.id,
          businessId: result.profile.businessId,
          userId: result.profile.userId,
          firstName: result.profile.firstName,
          lastName: result.profile.lastName,
          displayName: result.profile.displayName,
        },
      };
    } catch (error) {
      // This transaction's only unique/PK constraint besides each row's own
      // generated id is `(email, user_type)` — unlike admin invite, there
      // is no second constraint a P2002 here could ambiguously belong to,
      // but the same precise helper is used anyway for consistency.
      if (isUniqueConstraintViolation(error, 'email')) {
        return { ok: false, reason: 'EMAIL_TAKEN' };
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
