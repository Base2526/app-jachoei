// src/lib/normalizePhone.ts

export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const digits = String(raw).trim().replace(/[^\d]/g, "");
  if (!digits) return "";

  // Canonical: digits only
  // Thai: 0xxxxxxxxx (10 digits) -> 66xxxxxxxxx
  if (digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return digits;
}
