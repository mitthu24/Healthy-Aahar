import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  DeliveryPartnerListFilter,
  DeliveryPartnerRepository,
  DeliveryPartnerRow,
} from '../ports/delivery-partner-repository.js';
import type { RoleRepository } from '../ports/admin-repository.js';
import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { RbacService } from './rbac-service.js';

export type DeliveryPartnerServiceDeps = {
  partners: DeliveryPartnerRepository;
  roles: RoleRepository;
  rbac: RbacService;
  audit: AuditLogRepository;
};

export type CreateDeliveryPartnerParams = {
  email?: string | undefined;
  /** STAGE C: email-free login identifier — see `RbacService.inviteAdmin`. */
  loginId?: string | undefined;
  fullName: string;
  employeeCode?: string | undefined;
  vehicleType?: string | undefined;
  vehicleNumber?: string | undefined;
  actorUserId: string;
};

/**
 * Admin-side delivery-partner account management (PHASE 06).
 *
 * A delivery partner IS an `AdminUser` — invite/session/deactivation/
 * reactivation are `RbacService` calls, reused wholesale rather than
 * reimplemented (the same BR-SEC10 session-revocation-on-deactivate
 * guarantee a regular employee gets, a partner gets for free). This service
 * adds only what's genuinely partner-specific: the profile row (duty
 * status, vehicle info) and resolving the fixed `DELIVERY_PARTNER` role.
 */
export class DeliveryPartnerService {
  private readonly partners: DeliveryPartnerRepository;
  private readonly roles: RoleRepository;
  private readonly rbac: RbacService;
  private readonly audit: AuditLogRepository;

  constructor({ partners, roles, rbac, audit }: DeliveryPartnerServiceDeps) {
    this.partners = partners;
    this.roles = roles;
    this.rbac = rbac;
    this.audit = audit;
  }

  async create(
    scope: BusinessScope,
    params: CreateDeliveryPartnerParams,
  ): Promise<{ partner: DeliveryPartnerRow; passwordResetLink: string }> {
    const role = await this.roles.findByKey(scope, 'DELIVERY_PARTNER');
    if (!role) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The DELIVERY_PARTNER role is not configured for this business. Run the role seed first.',
      );
    }

    const { admin, passwordResetLink } = await this.rbac.inviteAdmin(scope, {
      email: params.email,
      loginId: params.loginId,
      fullName: params.fullName,
      roleIds: [role.id],
      invitedByUserId: params.actorUserId,
      // DELIVERY_PARTNER grants no roles:manage / Super Admin, so this is
      // never a privilege-escalation path regardless of the actor's own
      // Super Admin status — passed false defensively, matching the
      // principle of least privilege for this call site.
      invitedByIsSuperAdmin: false,
    });

    const profile = await this.partners.createProfile(scope, admin.id, {
      vehicleType: params.vehicleType,
      vehicleNumber: params.vehicleNumber,
    });

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'delivery_partner.created',
      resourceType: 'delivery_partner',
      resourceId: admin.id,
    });

    return { partner: profile, passwordResetLink };
  }

  async list(
    scope: BusinessScope,
    filter: DeliveryPartnerListFilter,
  ): Promise<DeliveryPartnerRow[]> {
    return this.partners.list(scope, filter);
  }

  async get(scope: BusinessScope, adminUserId: string): Promise<DeliveryPartnerRow> {
    const partner = await this.partners.findByAdminUserId(scope, adminUserId);
    if (!partner) throw new DomainError('PARTNER_NOT_FOUND', 'Delivery partner not found.');
    return partner;
  }

  /** Reuses RbacService.deactivate wholesale — BR-SEC10 session revocation included. */
  async suspend(
    scope: BusinessScope,
    params: { adminUserId: string; actorAdminUserId: string; actorUserId: string },
  ) {
    await this.get(scope, params.adminUserId);
    await this.rbac.deactivate(scope, {
      targetAdminUserId: params.adminUserId,
      actorAdminUserId: params.actorAdminUserId,
      actorUserId: params.actorUserId,
    });
    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'delivery_partner.suspended',
      resourceType: 'delivery_partner',
      resourceId: params.adminUserId,
    });
    return this.get(scope, params.adminUserId);
  }

  async reactivate(scope: BusinessScope, params: { adminUserId: string; actorUserId: string }) {
    await this.get(scope, params.adminUserId);
    await this.rbac.reactivate(scope, {
      targetAdminUserId: params.adminUserId,
      actorUserId: params.actorUserId,
    });
    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'delivery_partner.reactivated',
      resourceType: 'delivery_partner',
      resourceId: params.adminUserId,
    });
    return this.get(scope, params.adminUserId);
  }
}
