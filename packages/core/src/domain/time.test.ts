import { describe, expect, it } from 'vitest';

import {
  addDays,
  businessDate,
  businessDateTimeToUtc,
  daysBetween,
  fixedClock,
  formatBusinessDateTime,
  isoWeekday,
  isValidBusinessDate,
  now,
  todayInBusinessTimezone,
} from './time.js';

describe('businessDate', () => {
  it('returns the Asia/Kolkata date, not the UTC date', () => {
    // 2026-09-20 19:30 UTC is 2026-09-21 01:00 IST. The business day has
    // already rolled over even though UTC has not — this is exactly the bug
    // that a naive toISOString().slice(0,10) would produce.
    const instant = new Date('2026-09-20T19:30:00Z');

    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-20');
    expect(businessDate(instant)).toBe('2026-09-21');
  });

  it('handles the IST midnight boundary', () => {
    expect(businessDate(new Date('2026-09-20T18:29:59Z'))).toBe('2026-09-20');
    expect(businessDate(new Date('2026-09-20T18:30:00Z'))).toBe('2026-09-21');
  });

  it('respects an alternative timezone', () => {
    const instant = new Date('2026-09-20T19:30:00Z');
    expect(businessDate(instant, 'UTC')).toBe('2026-09-20');
    expect(businessDate(instant, 'Asia/Kolkata')).toBe('2026-09-21');
  });
});

describe('todayInBusinessTimezone', () => {
  it('uses the injected clock so cutoff logic is testable', () => {
    const clock = fixedClock('2026-09-20T19:30:00Z');
    expect(todayInBusinessTimezone(clock)).toBe('2026-09-21');
  });
});

describe('isoWeekday', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    // 2026-09-21 is a Monday.
    expect(isoWeekday('2026-09-21')).toBe(1);
    expect(isoWeekday('2026-09-27')).toBe(7);
  });

  it('matches the delivery_slots.available_days convention', () => {
    const weekdays = [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ];
    expect(weekdays.map((d) => isoWeekday(d))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('addDays / daysBetween', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('adds days across a leap-year boundary', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('subtracts with a negative offset', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-20', '2026-09-27')).toBe(7);
    expect(daysBetween('2026-09-27', '2026-09-20')).toBe(-7);
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
  });
});

describe('isValidBusinessDate', () => {
  it('accepts a real date', () => {
    expect(isValidBusinessDate('2026-09-20')).toBe(true);
  });

  it('rejects a malformed or impossible date', () => {
    expect(isValidBusinessDate('2026-9-20')).toBe(false);
    expect(isValidBusinessDate('2026-02-30')).toBe(false);
    expect(isValidBusinessDate('not-a-date')).toBe(false);
  });
});

describe('businessDateTimeToUtc', () => {
  it('converts an IST wall-clock time to the correct UTC instant', () => {
    // 22:00 IST on 2026-09-21 is 16:30 UTC the same day. This is the
    // primitive PHASE 06 builds cutoff_at on (BR-D3).
    const instant = businessDateTimeToUtc('2026-09-21', '22:00');
    expect(instant.toISOString()).toBe('2026-09-21T16:30:00.000Z');
  });

  it('converts an early-morning slot time', () => {
    // 07:00 IST — the configured morning slot — is 01:30 UTC.
    const instant = businessDateTimeToUtc('2026-09-22', '07:00');
    expect(instant.toISOString()).toBe('2026-09-22T01:30:00.000Z');
  });

  it('converts an evening slot time', () => {
    // 18:00 IST is 12:30 UTC.
    const instant = businessDateTimeToUtc('2026-09-22', '18:00');
    expect(instant.toISOString()).toBe('2026-09-22T12:30:00.000Z');
  });

  it('round-trips back to the same business date', () => {
    const instant = businessDateTimeToUtc('2026-09-21', '22:00');
    expect(businessDate(instant)).toBe('2026-09-21');
  });
});

describe('now', () => {
  it('reads the system clock by default', () => {
    const before = Date.now();
    const instant = now();
    expect(instant.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('reads an injected clock, which is what makes cutoff logic testable', () => {
    const instant = now(fixedClock('2026-09-21T16:30:00Z'));
    expect(instant.toISOString()).toBe('2026-09-21T16:30:00.000Z');
  });

  it('returns a fresh Date each call so a caller cannot mutate the clock', () => {
    const clock = fixedClock('2026-09-21T16:30:00Z');
    const a = now(clock);
    a.setUTCFullYear(1999);
    expect(now(clock).toISOString()).toBe('2026-09-21T16:30:00.000Z');
  });
});

describe('isoWeekday with an instant', () => {
  it('uses the business timezone, not UTC', () => {
    // 2026-09-20T19:30Z is Sunday in UTC but already Monday in IST.
    const instant = new Date('2026-09-20T19:30:00Z');
    expect(isoWeekday(instant, 'UTC')).toBe(7);
    expect(isoWeekday(instant)).toBe(1);
  });
});

describe('formatBusinessDateTime', () => {
  it('renders an IST label for a UTC instant', () => {
    // 16:30 UTC is 22:00 IST — the cutoff label a customer actually sees.
    //
    // Asserted by component rather than as an exact string: ICU renders the
    // month as "Sep" on Node 22 and "Sept" on Node 24, so an exact match
    // would pass locally and fail in CI for no real reason.
    const label = formatBusinessDateTime(new Date('2026-09-21T16:30:00Z'));

    expect(label).toContain('21');
    expect(label).toContain('2026');
    expect(label).toMatch(/Sep/);
    expect(label).toContain('10:00');
    expect(label.toLowerCase()).toContain('pm');
    // The crucial assertion: IST, not UTC. A UTC render would say 4:30 pm.
    expect(label).not.toContain('4:30');
  });
});

describe('todayInBusinessTimezone', () => {
  it('falls back to the system clock when none is supplied', () => {
    expect(isValidBusinessDate(todayInBusinessTimezone())).toBe(true);
  });
});
