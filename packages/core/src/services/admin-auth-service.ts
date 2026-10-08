import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AdminRepository, AdminUserRow } from '../ports/admin-repository.js';

export type AdminActor = {
  kind: 'ADMIN';
  userId: string;
  adminUserId: string;
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
};

/**
 * Resolves a verified admin Firebase identity to an `Actor` (docs/07 §6).
 *
 * Every admin-authenticated request re-checks `users.status` — a Firebase
 * session cookie stays cryptographically valid for up to 12 hours, but
 * suspending an account in our own database must take effect on the very
 * next request (BR-SEC3), not up to 12 hours later.
 */
export class AdminAuthService {
  constructor(private readonly admins: AdminRepository) {}

  async resolveActor(scope: BusinessScope, firebaseUid: string): Promise<AdminActor> {
    const found = await this.admins.findByFirebaseUid(scope, firebaseUid);

    if (!found) {
      throw new DomainError('UNAUTHENTICATED', 'No admin account exists for this identity.');
    }

    const { user, admin } = found;

    if (user.status !== 'ACTIVE') {
      throw new DomainError('ACCOUNT_SUSPENDED', 'This admin account is suspended or deactivated.');
    }
    if (admin.deletedAt) {
      throw new DomainError('ACCOUNT_SUSPENDED', 'This admin account has been deactivated.');
    }

    const effective = await this.admins.loadEffectivePermissions(scope, admin.id);

    return {
      kind: 'ADMIN',
      userId: user.id,
      adminUserId: admin.id,
      permissions: new Set(effective.permissions),
      isSuperAdmin: effective.isSuperAdmin,
    };
  }

  /** For GET /v1/admin/auth/me and the login response — display data, not authorization. */
  async getProfile(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null> {
    return this.admins.findById(scope, adminUserId);
  }
}
