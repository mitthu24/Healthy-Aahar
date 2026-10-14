/**
 * Contact-field masking for the founder customer directory (Stage E).
 *
 * Masking happens here, once, rather than ad hoc in each caller — the same
 * reasoning as `money.ts`'s single formatting point. `customers:read`
 * callers get masked output; `customers:read_pii` callers get the real
 * value (and `CustomerAdminService` audits every one of those reads).
 */

/** `j***n@example.com` — keeps the first and last character of the local
 *  part and the full domain (so support staff can still recognise which
 *  customer a masked row refers to without exposing the real address). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const masked =
    local.length <= 2
      ? '*'.repeat(local.length)
      : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

/** `+********3210` — keeps a leading `+` (if present) and the last 4
 *  digits, masks everything between. Deliberately does NOT try to parse
 *  out a country code (it varies 1-3 digits and a regex can't disambiguate
 *  it from the subscriber number without a lookup table) — "everything but
 *  the leading + and the last 4 digits" is unambiguous and still enough
 *  for support staff to recognise a customer's own number. */
export function maskPhone(phone: string): string {
  const hasPlus = phone.startsWith('+');
  const digits = hasPlus ? phone.slice(1) : phone;
  const prefix = hasPlus ? '+' : '';
  if (digits.length <= 4) return `${prefix}${'*'.repeat(digits.length)}`;
  const last4 = digits.slice(-4);
  return `${prefix}${'*'.repeat(digits.length - 4)}${last4}`;
}
