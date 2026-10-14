/**
 * Minimal RFC 4180 CSV encoding. No external dependency for something this
 * small — quote a field only when it needs it (contains a comma, quote, or
 * newline), doubling any internal quotes.
 */
export function toCsvField(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function toCsvRow(fields: Array<string | number | boolean | null | undefined>): string {
  return fields.map(toCsvField).join(',');
}

export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join('\r\n') + '\r\n';
}
