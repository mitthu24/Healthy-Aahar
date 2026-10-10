import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Customer address persistence (docs/14 §3.10).
 *
 * `deliveryZoneId` is resolved by the adapter from pincode -> zone lookups at
 * write time (the same dynamic, admin-configured system serviceability uses
 * — never a hardcoded allowlist, BR-SV1). It may be null: an address can be
 * saved even when it does not resolve to a deliverable zone today; checkout
 * requires a resolved zone, saving an address does not.
 */
export type AddressRow = {
  id: string;
  businessId: string;
  customerProfileId: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  deliveryInstructions: string | null;
  isDefault: boolean;
  deliveryZoneId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AddressInput = {
  label?: string | undefined;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2?: string | undefined;
  landmark?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  deliveryInstructions?: string | undefined;
  isDefault?: boolean | undefined;
};

export interface AddressRepository {
  list(scope: BusinessScope, customerProfileId: string): Promise<AddressRow[]>;
  get(scope: BusinessScope, customerProfileId: string, id: string): Promise<AddressRow | null>;
  create(scope: BusinessScope, customerProfileId: string, input: AddressInput): Promise<AddressRow>;
  update(
    scope: BusinessScope,
    customerProfileId: string,
    id: string,
    input: Partial<AddressInput>,
  ): Promise<AddressRow>;
  delete(scope: BusinessScope, customerProfileId: string, id: string): Promise<void>;
}
