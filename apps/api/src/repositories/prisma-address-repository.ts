import {
  newId,
  now,
  type AddressInput,
  type AddressRepository,
  type AddressRow,
  type BusinessScope,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementation of customer addresses (docs/14 §3.10).
 *
 * `deliveryZoneId` is re-resolved from the business's `ServicePincode` table
 * on every create/update that touches the pincode — the same dynamic,
 * admin-configured lookup serviceability already uses (BR-SV1, BR-SV9: the
 * city gate runs first). It is never a hardcoded allowlist, and it may
 * resolve to null; checkout is what requires a resolved zone, not saving the
 * address.
 */
export class PrismaAddressRepository implements AddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope, customerProfileId: string): Promise<AddressRow[]> {
    const rows = await this.prisma.address.findMany({
      where: { customerProfileId, deletedAt: null, customerProfile: { businessId: scope } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.toRow(row, scope));
  }

  async get(
    scope: BusinessScope,
    customerProfileId: string,
    id: string,
  ): Promise<AddressRow | null> {
    const row = await this.prisma.address.findFirst({
      where: { id, customerProfileId, deletedAt: null, customerProfile: { businessId: scope } },
    });
    return row ? this.toRow(row, scope) : null;
  }

  async create(
    scope: BusinessScope,
    customerProfileId: string,
    input: AddressInput,
  ): Promise<AddressRow> {
    const deliveryZoneId = await this.resolveZone(scope, input.pincode);

    if (input.isDefault) {
      await this.prisma.address.updateMany({
        where: { customerProfileId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await this.prisma.address.create({
      data: {
        id: newId(),
        customerProfileId,
        label: input.label ?? null,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        country: 'IN',
        deliveryInstructions: input.deliveryInstructions ?? null,
        isDefault: input.isDefault ?? false,
        deliveryZoneId,
      },
    });

    return this.toRow(created, scope);
  }

  async update(
    scope: BusinessScope,
    customerProfileId: string,
    id: string,
    input: Partial<AddressInput>,
  ): Promise<AddressRow> {
    const deliveryZoneId = input.pincode ? await this.resolveZone(scope, input.pincode) : undefined;

    if (input.isDefault) {
      await this.prisma.address.updateMany({
        where: { customerProfileId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.address.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.recipientName !== undefined ? { recipientName: input.recipientName } : {}),
        ...(input.recipientPhone !== undefined ? { recipientPhone: input.recipientPhone } : {}),
        ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
        ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
        ...(input.landmark !== undefined ? { landmark: input.landmark } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.pincode !== undefined ? { pincode: input.pincode, deliveryZoneId } : {}),
        ...(input.deliveryInstructions !== undefined
          ? { deliveryInstructions: input.deliveryInstructions }
          : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        updatedAt: now(),
      },
    });

    return this.toRow(updated, scope);
  }

  async delete(_scope: BusinessScope, _customerProfileId: string, id: string): Promise<void> {
    await this.prisma.address.update({ where: { id }, data: { deletedAt: now() } });
  }

  private async resolveZone(scope: BusinessScope, pincode: string): Promise<string | null> {
    const servicePincode = await this.prisma.servicePincode.findUnique({
      where: { businessId_pincode: { businessId: scope, pincode } },
      select: { status: true, deliveryZoneId: true, city: { select: { status: true } } },
    });

    if (!servicePincode) return null;
    if (servicePincode.status !== 'ACTIVE' || servicePincode.city.status !== 'ACTIVE') return null;
    return servicePincode.deliveryZoneId;
  }

  private toRow(
    row: Prisma.AddressGetPayload<Record<string, never>>,
    scope: BusinessScope,
  ): AddressRow {
    return {
      id: row.id,
      businessId: scope,
      customerProfileId: row.customerProfileId,
      label: row.label,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      line1: row.line1,
      line2: row.line2,
      landmark: row.landmark,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      country: row.country,
      deliveryInstructions: row.deliveryInstructions,
      isDefault: row.isDefault,
      deliveryZoneId: row.deliveryZoneId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
