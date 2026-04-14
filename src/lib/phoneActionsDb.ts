import { runAsync } from "./db";
import { normalizePhone } from "./normalizePhone";

export type LocalPhoneInfo = {
  phone: string;
  phone_normalized: string;
  local_blocked: boolean;
  report_count: number;
  risk_level: number;
  tags: string[];
  last_report_at: string | null;
  updated_at: string | null;
  server_deleted: number;
};

export type BlockedLogInput = {
  phone: string;
  rawPhone?: string | null;
  type?: "call" | "sms";
  detail?: string | null;
};

function getFirstRow(rows: any): any | null {
  const list = rows?.raw?.() ?? rows?._array ?? [];
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    }
  } catch {
    // fall back to comma-delimited tags
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function getLocalPhoneInfo(phoneRaw: string): Promise<LocalPhoneInfo | null> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;

  const res = await runAsync(
    `
    SELECT phone_normalized, local_blocked, report_count, risk_level, tags, last_report_at, server_updated_at, server_deleted
    FROM scam_phones
    WHERE phone_normalized = ?
    LIMIT 1;
    `,
    [phone]
  );

  const row = getFirstRow(res.rows);
  if (!row) return null;

  return {
    phone,
    phone_normalized: String(row.phone_normalized || phone),
    local_blocked: Number(row.local_blocked || 0) === 1,
    report_count: Number(row.report_count || 0),
    risk_level: Number(row.risk_level || 0),
    tags: parseTags(row.tags),
    last_report_at: row.last_report_at ? String(row.last_report_at) : null,
    updated_at: row.server_updated_at ? String(row.server_updated_at) : null,
    server_deleted: Number(row.server_deleted || 0),
  };
}

export async function upsertLocalPhoneInfo(input: {
  phone: string;
  report_count?: number;
  risk_level?: number;
  tags?: string[];
  last_report_at?: string | null;
  updated_at?: string | null;
  local_blocked?: boolean;
  server_deleted?: number;
}): Promise<LocalPhoneInfo> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Invalid phone");

  const existing = await getLocalPhoneInfo(phone);
  const reportCount = Math.max(0, Number(input.report_count ?? existing?.report_count ?? 0));
  const riskLevel = Math.max(0, Number(input.risk_level ?? existing?.risk_level ?? 0));
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags ?? [];
  const lastReportAt = input.last_report_at ?? existing?.last_report_at ?? null;
  const updatedAt = input.updated_at ?? existing?.updated_at ?? new Date().toISOString();
  const localBlocked = input.local_blocked ?? existing?.local_blocked ?? false;
  const serverDeleted = Number(input.server_deleted ?? existing?.server_deleted ?? 0);

  await runAsync(
    `
    INSERT INTO scam_phones (
      phone_normalized,
      report_count,
      last_report_at,
      risk_level,
      tags,
      server_updated_at,
      server_deleted,
      local_blocked
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone_normalized) DO UPDATE SET
      report_count = excluded.report_count,
      last_report_at = excluded.last_report_at,
      risk_level = excluded.risk_level,
      tags = excluded.tags,
      server_updated_at = excluded.server_updated_at,
      server_deleted = excluded.server_deleted,
      local_blocked = excluded.local_blocked;
    `,
    [
      phone,
      reportCount,
      lastReportAt,
      riskLevel,
      JSON.stringify(tags),
      updatedAt,
      serverDeleted,
      localBlocked ? 1 : 0,
    ]
  );

  return {
    phone,
    phone_normalized: phone,
    local_blocked: localBlocked,
    report_count: reportCount,
    risk_level: riskLevel,
    tags,
    last_report_at: lastReportAt,
    updated_at: updatedAt,
    server_deleted: serverDeleted,
  };
}

export async function setLocalBlocked(phoneRaw: string, blocked: boolean): Promise<LocalPhoneInfo> {
  return upsertLocalPhoneInfo({
    phone: phoneRaw,
    local_blocked: blocked,
    updated_at: new Date().toISOString(),
  });
}

export async function appendBlockedLog(input: BlockedLogInput): Promise<void> {
  const phone = normalizePhone(input.phone);
  if (!phone) return;

  await runAsync(
    `
    INSERT INTO blocked_logs (phone_normalized, raw_phone, type, detail)
    VALUES (?, ?, ?, ?);
    `,
    [phone, input.rawPhone ?? null, input.type ?? "call", input.detail ?? null]
  );
}

export async function clearLocalPhoneUserScopedState(): Promise<{ resetBlockedRows: number; removedLogRows: number }> {
  const resetBlocked = await runAsync(
    `
    UPDATE scam_phones
    SET local_blocked = 0
    WHERE local_blocked = 1;
    `
  );

  const clearLogs = await runAsync(`DELETE FROM blocked_logs;`);

  return {
    resetBlockedRows: Number((resetBlocked as any)?.rowsAffected ?? 0),
    removedLogRows: Number((clearLogs as any)?.rowsAffected ?? 0),
  };
}