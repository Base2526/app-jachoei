// src/lib/db-blocked-logs.ts
import { runAsync } from "./db"; // หรือ path ของคุณ

export type BlockedLog = {
  id: number;
  phone_normalized: string;
  raw_phone: string | null;
  type: "call" | "sms";
  created_at: string;
  detail: string | null;
};

type LoadOptions = {
  type?: "call" | "sms";   // filter by type
  search?: string;         // filter by phone
  limit?: number;
  offset?: number;
};

export async function loadBlockedLogs(
  options: LoadOptions = {}
): Promise<BlockedLog[]> {
  const { type, search, limit = 100, offset = 0 } = options;

  const where: string[] = [];
  const params: any[] = [];

  if (type) {
    where.push("type = ?");
    params.push(type);
  }

  if (search && search.trim() !== "") {
    where.push("(phone_normalized LIKE ? OR raw_phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT id, phone_normalized, raw_phone, type, created_at, detail
    FROM blocked_logs
    ${whereSql}
    ORDER BY datetime(created_at) DESC
    LIMIT ${limit} OFFSET ${offset};
  `;

  const res = await runAsync(sql, params);

  // แปลงผลจาก react-native-sqlite-storage
  const rows =
    // ถ้าใช้เวอร์ชันใหม่
    (res.rows as any).raw?.() ??
    // หรือแบบเดิม
    (res.rows as any)._array ??
    [];

  return rows as BlockedLog[];
}
