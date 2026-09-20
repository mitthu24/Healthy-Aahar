/**
 * Time.
 *
 * Every instant is UTC. Every *business day* is `Asia/Kolkata` (ADR-007).
 * All conversion happens here — no route handler, component or job does date
 * arithmetic of its own.
 *
 * A real timezone is used rather than a fixed +05:30 offset so that a future
 * city in a DST zone does not require rewriting this file. India does not
 * observe DST today; that is not a reason to hard-code the assumption.
 */

export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Kolkata';

/** ISO weekday: 1 = Monday ... 7 = Sunday, matching `delivery_slots.available_days`. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A bare business date, `YYYY-MM-DD`. Never a Date — a Date is an instant,
 *  and "the morning of 14 March" is not an instant. */
export type BusinessDate = string;

/**
 * Injectable clock. Application code takes a Clock rather than calling
 * `new Date()`, which is what makes cutoff and scheduling logic testable
 * without freezing the system clock. A lint rule bans bare `new Date()`.
 */
export type Clock = { now(): Date };

export const systemClock: Clock = {
  // The single place in the codebase permitted to read the wall clock.
  // Everything else takes a Clock, which is what makes cutoff and scheduling
  // logic testable without freezing the system clock.
  // eslint-disable-next-line no-restricted-syntax
  now: () => new Date(),
};

/**
 * Read the current instant.
 *
 * The sanctioned alternative to a bare `new Date()`, which is banned by lint.
 * Routing every clock read through here means a future change — a test clock,
 * a monotonic source, a skew correction — is a one-line change rather than a
 * codebase-wide search.
 */
export function now(clock: Clock = systemClock): Date {
  return clock.now();
}

export function fixedClock(instant: Date | string): Clock {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return { now: () => new Date(value.getTime()) };
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: IsoWeekday;
};

const WEEKDAY_TO_ISO: Record<string, IsoWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  // `hour12: false` can yield "24" for midnight in some engines.
  const rawHour = Number(get('hour'));

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_TO_ISO[get('weekday')] ?? 1,
  };
}

/** The current business date, for example "2026-09-20". */
export function businessDate(
  instant: Date,
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): BusinessDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayInBusinessTimezone(
  clock: Clock = systemClock,
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): BusinessDate {
  return businessDate(clock.now(), timeZone);
}

export function isoWeekday(
  dateOrInstant: BusinessDate | Date,
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): IsoWeekday {
  if (dateOrInstant instanceof Date) {
    return zonedParts(dateOrInstant, timeZone).weekday;
  }
  // A bare date has no timezone; interpret it at noon UTC so that no offset
  // can push it onto an adjacent day.
  const instant = new Date(`${dateOrInstant}T12:00:00Z`);
  const jsDay = instant.getUTCDay();
  return (jsDay === 0 ? 7 : jsDay) as IsoWeekday;
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function isValidBusinessDate(value: string): value is BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

/**
 * Convert a business date plus a wall-clock time in the business timezone into
 * an absolute UTC instant.
 *
 * This is the primitive that PHASE 06 builds `cutoff_at` on: the server always
 * returns an absolute instant so that a customer with a wrong device clock, or
 * one travelling in another timezone, sees exactly the same deadline the
 * kitchen does (BR-D3, EC-D7, EC-D8).
 */
export function businessDateTimeToUtc(
  date: BusinessDate,
  time: string,
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): Date {
  const [hourStr = '0', minuteStr = '0'] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // Start from the naive UTC interpretation, then correct by the zone offset
  // measured at that very instant, so the result is correct across DST edges.
  const naive = Date.parse(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  const probe = new Date(naive);
  const parts = zonedParts(probe, timeZone);

  const asZoned = Date.parse(
    `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` +
      `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}Z`,
  );

  const offsetMs = asZoned - naive;
  return new Date(naive - offsetMs);
}

/** Human label in the business timezone, e.g. "Sun, 20 Sep 2026, 10:00 PM". */
export function formatBusinessDateTime(
  instant: Date,
  timeZone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
}
