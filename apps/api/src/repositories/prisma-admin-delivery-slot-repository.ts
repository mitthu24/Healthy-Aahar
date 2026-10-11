import {
  DomainError,
  newId,
  now,
  type AdminDeliverySlotRepository,
  type AdminDeliverySlotRow,
  type BusinessScope,
  type DeliverySlotInput,
  type DeliverySlotUpdateInput,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

import { isUniqueConstraintViolation } from './prisma-errors.js';

function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

function toRow(raw: {
  id: string;
  businessId: string;
  name: string;
  code: string;
  startTime: Date;
  endTime: Date;
  cutoffTime: Date;
  cutoffDaysBefore: number;
  availableDays: number[];
  defaultCapacity: number;
  deliveryFeePaise: bigint | null;
  minOrderValuePaise: bigint | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): AdminDeliverySlotRow {
  return {
    id: raw.id,
    businessId: raw.businessId,
    name: raw.name,
    code: raw.code,
    startTime: raw.startTime,
    endTime: raw.endTime,
    cutoffTime: raw.cutoffTime,
    cutoffDaysBefore: raw.cutoffDaysBefore,
    availableDays: raw.availableDays,
    defaultCapacity: raw.defaultCapacity,
    deliveryFeePaise: raw.deliveryFeePaise,
    minOrderValuePaise: raw.minOrderValuePaise,
    isActive: raw.isActive,
    displayOrder: raw.displayOrder,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export class PrismaAdminDeliverySlotRepository implements AdminDeliverySlotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope): Promise<AdminDeliverySlotRow[]> {
    const rows = await this.prisma.deliverySlot.findMany({
      where: { businessId: scope, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toRow);
  }

  async findById(scope: BusinessScope, id: string): Promise<AdminDeliverySlotRow | null> {
    const row = await this.prisma.deliverySlot.findFirst({
      where: { id, businessId: scope, deletedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async findByCode(scope: BusinessScope, code: string): Promise<AdminDeliverySlotRow | null> {
    const row = await this.prisma.deliverySlot.findFirst({
      where: { code, businessId: scope, deletedAt: null },
    });
    return row ? toRow(row) : null;
  }

  async create(
    scope: BusinessScope,
    input: DeliverySlotInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    try {
      const created = await this.prisma.deliverySlot.create({
        data: {
          id: newId(),
          businessId: scope,
          name: input.name,
          code: input.code,
          startTime: toTime(input.startTime),
          endTime: toTime(input.endTime),
          cutoffTime: toTime(input.cutoffTime ?? input.startTime),
          cutoffDaysBefore: input.cutoffDaysBefore,
          availableDays: input.availableDays,
          defaultCapacity: input.defaultCapacity,
          deliveryFeePaise:
            input.deliveryFeePaise !== undefined ? BigInt(input.deliveryFeePaise) : null,
          minOrderValuePaise:
            input.minOrderValuePaise !== undefined ? BigInt(input.minOrderValuePaise) : null,
          displayOrder: input.displayOrder,
          createdBy: actorUserId,
        },
      });
      return toRow(created);
    } catch (error) {
      if (isUniqueConstraintViolation(error, 'code')) {
        throw new DomainError(
          'SLUG_ALREADY_IN_USE',
          'A delivery slot with this code already exists.',
        );
      }
      throw error;
    }
  }

  async update(
    scope: BusinessScope,
    id: string,
    input: DeliverySlotUpdateInput,
    actorUserId: string,
  ): Promise<AdminDeliverySlotRow> {
    void scope;
    const data: Prisma.DeliverySlotUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startTime !== undefined ? { startTime: toTime(input.startTime) } : {}),
      ...(input.endTime !== undefined ? { endTime: toTime(input.endTime) } : {}),
      ...(input.cutoffTime !== undefined ? { cutoffTime: toTime(input.cutoffTime) } : {}),
      ...(input.cutoffDaysBefore !== undefined ? { cutoffDaysBefore: input.cutoffDaysBefore } : {}),
      ...(input.availableDays !== undefined ? { availableDays: input.availableDays } : {}),
      ...(input.defaultCapacity !== undefined ? { defaultCapacity: input.defaultCapacity } : {}),
      ...(input.deliveryFeePaise !== undefined
        ? {
            deliveryFeePaise:
              input.deliveryFeePaise !== null ? BigInt(input.deliveryFeePaise) : null,
          }
        : {}),
      ...(input.minOrderValuePaise !== undefined
        ? {
            minOrderValuePaise:
              input.minOrderValuePaise !== null ? BigInt(input.minOrderValuePaise) : null,
          }
        : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedBy: actorUserId,
      updatedAt: now(),
    };

    const updated = await this.prisma.deliverySlot.update({ where: { id }, data });
    return toRow(updated);
  }
}
