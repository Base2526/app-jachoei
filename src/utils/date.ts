export function formatDateTime(ts?: string | null): string {
  if (!ts) return "";

  const raw = String(ts);
  const n = Number(raw);

  if (!Number.isNaN(n)) {
    const dateFromNumber = new Date(n);
    if (!Number.isNaN(dateFromNumber.getTime())) return dateFromNumber.toLocaleString();
  }

  const dateFromString = new Date(raw);
  if (!Number.isNaN(dateFromString.getTime())) return dateFromString.toLocaleString();

  return raw;
}
