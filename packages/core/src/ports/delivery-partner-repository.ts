import type { BusinessScope } from '../domain/business-scope.js';
import type { DutyStatus } from '../domain/duty-status.js';

export type DeliveryPartnerRow = {
  adminUserId: string;
  fullName: string;
  email: string | null;
  /** STAGE C: email-free login identifier, see schema.prisma's `User.loginId` doc comment. */
  loginId: string | null;
  employeeCode: string | null;
  dutyStatus: DutyStatus;
  dutyChangedAt: Date | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  deactivated: boolean;
  activeDeliveryCount: number;
};

export type DeliveryPartnerListFilter = {
  q?: string | undefined;
  dutyStatus?: DutyStatus | undefined;
};

export type CreateDeliveryPartnerProfileInput = {
  vehicleType?: string | undefined;
  vehicleNumber?: string | undefined;
};

export interface DeliveryPartnerRepository {
  list(scope: BusinessScope, filter: DeliveryPartnerListFilter): Promise<DeliveryPartnerRow[]>;
  findByAdminUserId(scope: BusinessScope, adminUserId: string): Promise<DeliveryPartnerRow | null>;
  /** Called once, right after `RbacService.inviteAdmin` creates the underlying AdminUser. */
  createProfile(
    scope: BusinessScope,
    adminUserId: string,
    input: CreateDeliveryPartnerProfileInput,
  ): Promise<DeliveryPartnerRow>;
  setDutyStatus(
    scope: BusinessScope,
    adminUserId: string,
    dutyStatus: DutyStatus,
  ): Promise<DeliveryPartnerRow>;
}
