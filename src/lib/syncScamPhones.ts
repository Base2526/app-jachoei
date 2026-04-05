// src/lib/syncScamPhones.ts

import { gql, ApolloClient } from "@apollo/client";
import { runAsync } from "./db";
import { normalizePhone } from "./normalizePhone";

// ===== GraphQL Queries =====
export const Q_SCAM_PHONES_SNAPSHOT = gql`
  query ScamPhonesSnapshot($cursor: String, $limit: Int!) {
    scamPhonesSnapshot(cursor: $cursor, limit: $limit) {
      cursor
      items {
        phone
        report_count
        last_report_at
        risk_level
        tags
        updated_at
        is_deleted
        post_ids
      }
    }
  }
`;

export const Q_SCAM_PHONES_DELTA = gql`
  query ScamPhonesDelta($sinceVersion: String!, $cursor: String, $limit: Int!) {
    scamPhonesDelta(
      sinceVersion: $sinceVersion
      cursor: $cursor
      limit: $limit
    ) {
      cursor
      items {
        phone
        report_count
        last_report_at
        risk_level
        tags
        updated_at
        is_deleted
        post_ids
      }
    }
  }
`;

export const Q_SCAM_PHONES_SEARCH = gql`
  query SearchScamPhones($q: String!, $limit: Int!) {
    searchScamPhones(q: $q, limit: $limit) {
      phone
      report_count
      last_report_at
      risk_level
      tags
      updated_at
      is_deleted
      post_ids
    }
  }
`;

/**
 * Type ฝั่ง client ให้โค้ดอ่านง่าย (optional, ไม่จำเป็นต้องตรงกับ server 100%)
 */
export type ScamPhoneItem = {
  phone: string;
  report_count: number;
  last_report_at: string | null;
  risk_level: number;
  tags: string[] | null;
  updated_at: string; // ใช้เป็น version
  is_deleted: boolean;
  post_ids?: string[];
};

export type ScamPhonesSnapshotResponse = {
  scamPhonesSnapshot: {
    cursor: string | null;
    items: ScamPhoneItem[];
  };
};

export type ScamPhonesDeltaResponse = {
  scamPhonesDelta: {
    cursor: string | null;
    items: ScamPhoneItem[];
  };
};


// =====================
// Helper: อ่าน row จาก SQLResultSet ให้รองรับทั้ง item() และ _array
// =====================

function getFirstRow(rows: any): any | null {
  if (!rows || rows.length === 0) return null;

  // expo-sqlite: rows.item(i)
  if (typeof rows.item === "function") {
    return rows.item(0);
  }

  // บางเคสมี _array
  if (Array.isArray(rows._array)) {
    return rows._array[0] ?? null;
  }

  return null;
}

function rowsToArray(rows: any): any[] {
  if (!rows) return [];
  if (typeof rows.raw === "function") {
    try {
      return rows.raw() || [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(rows._array)) return rows._array;
  const out: any[] = [];
  try {
    const len = typeof rows.length === "number" ? rows.length : 0;
    if (typeof rows.item === "function") {
      for (let i = 0; i < len; i++) out.push(rows.item(i));
    }
  } catch {
    // ignore
  }
  return out;
}

let didLogDbEnv = false;
async function logDbEnvOnce() {
  if (didLogDbEnv) return;
  didLogDbEnv = true;
  try {
    const vRes: any = await runAsync("SELECT sqlite_version() AS v;");
    const vRow = getFirstRow(vRes?.rows);
    const version = vRow?.v ?? "";

    const pRes: any = await runAsync("PRAGMA database_list;");
    const list = rowsToArray(pRes?.rows);
    const main = list.find((r: any) => r?.name === "main") || null;

    console.log("[ScamSync][DB_ENV]", {
      sqlite_version: version,
      main_path: main?.file || main?.path || "",
      db_list: list,
    });
  } catch (e) {
    console.warn("[ScamSync][DB_ENV] failed", e);
  }
}

// =====================
// Helper: upsert batch ScamPhoneItem ลง SQLite
// =====================

async function upsertBatch(items: ScamPhoneItem[]): Promise<void> {
  if (!items.length) return;

  await logDbEnvOnce();

  // Android devices can have older SQLite versions that don't support
  // `ON CONFLICT ... DO UPDATE` (UPSERT). Emulator often runs newer versions.
  // We auto-detect and fall back to a safe UPDATE + INSERT OR IGNORE.
  type UpsertMode = "unknown" | "upsert" | "legacy";
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  upsertMode = upsertMode || "unknown";

  for (const row of items) {
    const phone = normalizePhone(row.phone);
    const reportCount = row.report_count ?? 0;
    const lastReportAt = row.last_report_at ?? null;
    const riskLevel = row.risk_level ?? 0;
    const tagsJson = JSON.stringify(row.tags ?? []);
    const serverUpdatedAt = row.updated_at;
    const serverDeleted = row.is_deleted ? 1 : 0;

    // Try modern UPSERT first (once).
    if (upsertMode !== "legacy") {
      try {
        await runAsync(
          `
          INSERT INTO scam_phones (
            phone_normalized,
            report_count,
            last_report_at,
            risk_level,
            tags,
            server_updated_at,
            server_deleted
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(phone_normalized) DO UPDATE SET
            report_count      = excluded.report_count,
            last_report_at    = excluded.last_report_at,
            risk_level        = excluded.risk_level,
            tags              = excluded.tags,
            server_updated_at = excluded.server_updated_at,
            server_deleted    = excluded.server_deleted;
          `,
          [phone, reportCount, lastReportAt, riskLevel, tagsJson, serverUpdatedAt, serverDeleted]
        );

        if (upsertMode !== "upsert") {
          upsertMode = "upsert";
          console.log("[ScamSync][DB_WRITE] upsertMode=upsert");
        }
        continue;
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        // Typical old-SQLite error: "near \"DO\": syntax error"
        if (/near\s+"DO"\s*:\s*syntax error/i.test(msg) || /syntax error/i.test(msg)) {
          upsertMode = "legacy";
          console.warn("[ScamSync][DB_WRITE] UPSERT not supported; falling back to legacy mode:", msg);
        } else {
          // If not the known UPSERT incompatibility, bubble up.
          throw e;
        }
      }
    }

    // Legacy mode: UPDATE first (preserves local_blocked), then INSERT OR IGNORE if row didn't exist.
    const updateRes: any = await runAsync(
      `
      UPDATE scam_phones
      SET report_count = ?,
          last_report_at = ?,
          risk_level = ?,
          tags = ?,
          server_updated_at = ?,
          server_deleted = ?
      WHERE phone_normalized = ?;
      `,
      [reportCount, lastReportAt, riskLevel, tagsJson, serverUpdatedAt, serverDeleted, phone]
    );

    const rowsAffected = typeof updateRes?.rowsAffected === "number" ? updateRes.rowsAffected : 0;
    if (rowsAffected === 0) {
      await runAsync(
        `
        INSERT OR IGNORE INTO scam_phones (
          phone_normalized,
          report_count,
          last_report_at,
          risk_level,
          tags,
          server_updated_at,
          server_deleted,
          local_blocked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0);
        `,
        [phone, reportCount, lastReportAt, riskLevel, tagsJson, serverUpdatedAt, serverDeleted]
      );
    }
  }

  // Post-write sanity counts (helps confirm persistence on real device).
  try {
    const res: any = await runAsync(
      `
      SELECT
        COUNT(*) AS c,
        SUM(CASE WHEN local_blocked = 1 THEN 1 ELSE 0 END) AS lc,
        SUM(CASE WHEN server_deleted = 0 THEN 1 ELSE 0 END) AS alive
      FROM scam_phones;
      `
    );
    const row = getFirstRow(res?.rows);
    console.log("[ScamSync][DB_WRITE] counts", {
      total: row?.c ?? 0,
      local: row?.lc ?? 0,
      alive: row?.alive ?? 0,
      mode: upsertMode,
    });
  } catch (e) {
    console.warn("[ScamSync][DB_WRITE] count-after-write failed", e);
  }
}

let upsertMode: "unknown" | "upsert" | "legacy" = "unknown";

// =====================
// Helper: อ่าน last_version จาก sync_state
// =====================

async function getLastVersion(): Promise<string> {
  const res = await runAsync(
    `SELECT last_version FROM sync_state WHERE id = 1;`
  );

  const row = getFirstRow(res.rows);
  if (!row || !row.last_version) return "0";
  return String(row.last_version);
}

// =====================
// Initial sync (Snapshot) – ดึงทั้งหมดแบบ batch
// =====================

export async function initialScamSync(
  client: ApolloClient,
  batchSize = 1000
): Promise<void> {
  let cursor: string | null = null;
  let maxVersion: string | null = null;
  let total = 0;

  while (true) {
    const result: any = await client.query<ScamPhonesSnapshotResponse>({
      query: Q_SCAM_PHONES_SNAPSHOT,
      variables: { cursor, limit: batchSize },
      fetchPolicy: "network-only",
    });

    const data: any = result?.data;

    console.log("[initialScamSync] = ", data);
    const page = data?.scamPhonesSnapshot;
    if (!page) break;
    const items = page?.items ?? [];
    if (!items.length) break;

    await upsertBatch(items);

    total += items.length;

    for (const it of items) {
      if (!maxVersion || it.updated_at > maxVersion) {
        maxVersion = it.updated_at;
      }
    }

    cursor = page.cursor || null;
    if (!cursor) break;
  }

  if (maxVersion) {
    await runAsync(
      `
      UPDATE sync_state
      SET last_full_sync_at = ?, last_version = ?, local_rows = ?
      WHERE id = 1;
    `,
      [new Date().toISOString(), maxVersion, total]
    );
  }
}

// =====================
// Delta sync – ดึงเฉพาะที่ updated_at > last_version
// =====================

export async function deltaScamSync(
  client: ApolloClient,
  batchSize = 1000
): Promise<void> {
  const sinceVersion = await getLastVersion();
  let cursor: string | null = null;
  let maxVersion: string | null = sinceVersion;

  while (true) {
    const result: any = await client.query<ScamPhonesDeltaResponse>({
      query: Q_SCAM_PHONES_DELTA,
      variables: { sinceVersion, cursor, limit: batchSize },
      fetchPolicy: "network-only",
    });

    const data: any = result?.data;

    console.log("[deltaScamSync] = ", data);

    const page = data?.scamPhonesDelta;
    if (!page) break;
    const items = page?.items ?? [];
    if (!items.length) break;

    await upsertBatch(items);

    for (const it of items) {
      if (!maxVersion || it.updated_at > maxVersion) {
        maxVersion = it.updated_at;
      }
    }

    cursor = page.cursor || null;
    if (!cursor) break;
  }

  if (maxVersion && maxVersion !== sinceVersion) {
    await runAsync(
      `
      UPDATE sync_state
      SET last_delta_sync_at = ?, last_version = ?
      WHERE id = 1;
    `,
      [new Date().toISOString(), maxVersion]
    );
  }
}

// =====================
// Check เบอร์จาก local – ใช้ได้ทั้ง UI และ native debug
// =====================
export async function checkScamPhoneLocal(
  phoneRaw: string
): Promise<{ found: boolean; risk: number; reportCount: number }> {
  const phone = normalizePhone(phoneRaw);

  const res = await runAsync(
    `
    SELECT risk_level, report_count
    FROM scam_phones
    WHERE phone_normalized = ? AND server_deleted = 0
    LIMIT 1;
  `,
    [phone]
  );

  const row = getFirstRow(res.rows);
  if (!row) {
    return { found: false, risk: 0, reportCount: 0 };
  }

  return {
    found: true,
    risk: row.risk_level ?? 0,
    reportCount: row.report_count ?? 0,
  };
}

// call server ถ้า local ไม่เจอ แล้ว upsert ลง SQLite
export async function checkScamPhoneWithFallback(
  client: ApolloClient,
  phoneRaw: string
): Promise<{ found: boolean; risk: number; reportCount: number }> {
  console.log("[checkScam] start =", phoneRaw);

  try {
    // 1) local ก่อน
    const local = await checkScamPhoneLocal(phoneRaw);
    console.log("[checkScam] local =", local);
    if (local.found) return local;

    // 2) เรียก server
    const normalized = normalizePhone(phoneRaw);
    console.log("[checkScam] call server with =", normalized);

    const { data } = await client.query<any, any>({
      query: Q_SCAM_PHONES_SEARCH,
      variables: { q: normalized, limit: 10 },
      fetchPolicy: "network-only",
    });

    console.log("[checkScam] server data =", JSON.stringify(data));

    const items = data?.searchScamPhones ?? [];
    if (!items.length) {
      console.log("[checkScam] server not found");
      return { found: false, risk: 0, reportCount: 0 };
    }

    const match =
      items.find((it: any) => normalizePhone(it.phone) === normalized) ||
      items[0];

    // upsert ลง local
    // ... (เหมือนที่เขียนไว้ก่อนหน้า)

    if (match.is_deleted) {
      return { found: false, risk: 0, reportCount: 0 };
    }

    return {
      found: true,
      risk: match.risk_level,
      reportCount: match.report_count,
    };
  } catch (err: any) {
    console.error("[checkScam] ERROR =", err);
    // สำคัญ: โยนต่อให้ caller จัดการ ไม่ให้เป็น unhandled
    throw err;
  }
}

// =====================
// (optional) Helper: ดึง sync state มา debug/log
// =====================
export type SyncState = {
  last_full_sync_at: string | null;
  last_delta_sync_at: string | null;
  last_version: string | null;
  local_rows: number | null;
};

export async function getSyncState(): Promise<SyncState | null> {
  const res = await runAsync(
    `SELECT last_full_sync_at, last_delta_sync_at, last_version, local_rows
     FROM sync_state WHERE id = 1;`
  );

  const row = getFirstRow(res.rows);
  if (!row) return null;

  return {
    last_full_sync_at: row.last_full_sync_at ?? null,
    last_delta_sync_at: row.last_delta_sync_at ?? null,
    last_version: row.last_version ?? null,
    local_rows:
      typeof row.local_rows === "number"
        ? row.local_rows
        : row.local_rows != null
        ? Number(row.local_rows)
        : null,
  };
}