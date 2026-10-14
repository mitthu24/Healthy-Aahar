import { describe, expect, it, vi } from 'vitest';

import { businessScope } from '../domain/business-scope.js';
import type { DashboardRepository } from '../ports/dashboard-repository.js';
import { DashboardService } from './dashboard-service.js';

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');

function fakeRepo(): DashboardRepository {
  return {
    getSummary: vi.fn().mockResolvedValue({
      orderCount: 0,
      grossSalesPaise: 0,
      discountPaise: 0,
      cancelledCount: 0,
      cancelledValuePaise: 0,
      netSalesPaise: 0,
      collectedPaise: 0,
      refundedPaise: 0,
      outstandingCodPaise: 0,
      statusBreakdown: [],
      deliveredCount: 0,
      failedCount: 0,
      avgFulfilmentMinutes: null,
      onTimeDeliveredCount: 0,
      newCustomersCount: 0,
    }),
    getSalesTrend: vi.fn().mockResolvedValue([]),
    getTopProducts: vi.fn().mockResolvedValue([]),
    getInventoryAlerts: vi.fn().mockResolvedValue([]),
  };
}

describe('DashboardService date-range validation', () => {
  it('rejects a malformed date', async () => {
    const service = new DashboardService({ dashboard: fakeRepo() });
    await expect(
      service.getSummary(BUSINESS_ID, { from: 'not-a-date', to: '2026-06-15' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects from after to', async () => {
    const service = new DashboardService({ dashboard: fakeRepo() });
    await expect(
      service.getSummary(BUSINESS_ID, { from: '2026-06-15', to: '2026-06-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a span wider than the bound', async () => {
    const service = new DashboardService({ dashboard: fakeRepo() });
    await expect(
      service.getSummary(BUSINESS_ID, { from: '2020-01-01', to: '2026-12-31' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a same-day range (from === to)', async () => {
    const repo = fakeRepo();
    const service = new DashboardService({ dashboard: repo });
    await service.getSummary(BUSINESS_ID, { from: '2026-06-15', to: '2026-06-15' });
    expect(repo.getSummary).toHaveBeenCalledOnce();
  });

  it('resolves the range to a half-open [from 00:00 IST, (to+1) 00:00 IST) UTC window', async () => {
    const repo = fakeRepo();
    const service = new DashboardService({ dashboard: repo });
    await service.getSummary(BUSINESS_ID, { from: '2026-06-15', to: '2026-06-16' });

    const [, range] = (repo.getSummary as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      { from: Date; to: Date },
    ];
    // 2026-06-15 00:00 IST == 2026-06-14 18:30 UTC.
    expect(range.from.toISOString()).toBe('2026-06-14T18:30:00.000Z');
    // 2026-06-17 00:00 IST (to+1) == 2026-06-16 18:30 UTC.
    expect(range.to.toISOString()).toBe('2026-06-16T18:30:00.000Z');
  });
});

describe('DashboardService.getSummary average_order_value', () => {
  it('is null when every order in range is cancelled (zero non-cancelled denominator)', async () => {
    const repo = fakeRepo();
    (repo.getSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      orderCount: 2,
      grossSalesPaise: 1000,
      discountPaise: 0,
      cancelledCount: 2,
      cancelledValuePaise: 1000,
      netSalesPaise: 0,
      collectedPaise: 0,
      refundedPaise: 0,
      outstandingCodPaise: 0,
      statusBreakdown: [],
      deliveredCount: 0,
      failedCount: 0,
      avgFulfilmentMinutes: null,
      onTimeDeliveredCount: 0,
      newCustomersCount: 0,
    });
    const service = new DashboardService({ dashboard: repo });
    const result = await service.getSummary(BUSINESS_ID, { from: '2026-06-15', to: '2026-06-15' });
    expect(result.average_order_value).toBeNull();
  });
});
