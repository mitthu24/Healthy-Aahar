import type { BusinessScope } from '../domain/business-scope.js';
import type { AccountStatus } from './user-repository.js';

/**
 * Founder-facing customer directory (Stage E). Contact fields (`email`,
 * `phone`) arrive here UNMASKED — masking is the service layer's job
 * (`CustomerAdminService`), based on the caller's `customers:read_pii`
 * permission, never the repository's.
 *
 * `totalOrders`/`lifetimeValuePaise`/`lastOrderAt` are computed live from
 * `orders` here, NOT read from `CustomerProfile`'s own same-named columns —
 * those columns are never written by any code path in this codebase
 * (confirmed by inspection before building this), so trusting them would
 * silently show every customer as having zero orders regardless of their
 * real history.
 */
export type AdminCustomerRow = {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  status: AccountStatus;
  marketingOptIn: boolean;
  createdAt: Date;
  /** COUNT of this customer's non-cancelled orders. */
  totalOrders: number;
  /** SUM of `total_paise` across this customer's non-cancelled orders. */
  lifetimeValuePaise: number;
  lastOrderAt: Date | null;
};

export type AdminCustomerListFilter = {
  /** Case-insensitive substring match against name, email or phone. */
  q?: string | undefined;
  status?: AccountStatus | undefined;
};

export type AdminCustomerListPage = {
  limit: number;
  /** `(created_at, id)` keyset cursor, opaque — see `domain/pagination.ts`. */
  cursor?: { sortValue: string; id: string } | undefined;
};

export interface CustomerAdminRepository {
  list(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    page: AdminCustomerListPage,
  ): Promise<AdminCustomerRow[]>;
  get(scope: BusinessScope, customerProfileId: string): Promise<AdminCustomerRow | null>;
  /** Every row matching `filter`, unpaginated — for CSV export only. Callers
   *  must keep this bounded (a hard cap, not a true "export everything"). */
  listAllForExport(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    hardCap: number,
  ): Promise<AdminCustomerRow[]>;
}
