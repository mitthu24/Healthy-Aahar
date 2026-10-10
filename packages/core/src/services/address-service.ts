import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AddressInput, AddressRepository, AddressRow } from '../ports/address-repository.js';

export type AddressServiceDeps = { addresses: AddressRepository };

/**
 * Customer addresses (docs/14 §3.10).
 *
 * Every method is scoped by both `BusinessScope` and `customerProfileId` —
 * an address belongs to exactly one customer, and a cross-customer id lookup
 * must read as NOT_FOUND, never FORBIDDEN (docs/06 §1.6).
 */
export class AddressService {
  private readonly addresses: AddressRepository;

  constructor({ addresses }: AddressServiceDeps) {
    this.addresses = addresses;
  }

  list(scope: BusinessScope, customerProfileId: string): Promise<AddressRow[]> {
    return this.addresses.list(scope, customerProfileId);
  }

  async get(scope: BusinessScope, customerProfileId: string, id: string): Promise<AddressRow> {
    const address = await this.addresses.get(scope, customerProfileId, id);
    if (!address) throw new DomainError('NOT_FOUND', 'Address not found.');
    return address;
  }

  create(
    scope: BusinessScope,
    customerProfileId: string,
    input: AddressInput,
  ): Promise<AddressRow> {
    return this.addresses.create(scope, customerProfileId, input);
  }

  async update(
    scope: BusinessScope,
    customerProfileId: string,
    id: string,
    input: Partial<AddressInput>,
  ): Promise<AddressRow> {
    await this.get(scope, customerProfileId, id);
    return this.addresses.update(scope, customerProfileId, id, input);
  }

  async delete(scope: BusinessScope, customerProfileId: string, id: string): Promise<void> {
    await this.get(scope, customerProfileId, id);
    await this.addresses.delete(scope, customerProfileId, id);
  }
}
