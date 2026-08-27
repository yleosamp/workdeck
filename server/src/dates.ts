const mysqlTimestamp = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;

/** Converts MySQL DATETIME values (stored in UTC) into unambiguous ISO timestamps. */
export function utcTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = String(value).trim();
  const match = text.match(mysqlTimestamp);
  if (match) {
    const milliseconds = (match[3] ?? "").padEnd(3, "0").slice(0, 3);
    return `${match[1]}T${match[2]}${milliseconds ? `.${milliseconds}` : ""}Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
