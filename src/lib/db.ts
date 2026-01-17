// src/lib/db.ts
import SQLite, {
  SQLiteDatabase,
  ResultSet,
} from "react-native-sqlite-storage";

export const DB_NAME = "scam-protect.db";

// ให้ lib ทำงานแบบ Promise ง่าย ๆ
SQLite.enablePromise(true);

let dbInstance: SQLiteDatabase | null = null;

// lazy-open db ครั้งแรกที่มีคนเรียก
async function getDb(): Promise<SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await SQLite.openDatabase({
    name: DB_NAME,
    location: "default", // หรือ "Library" / "Documents" ตามที่ต้องการ
  },
  (dbObj) => {
    console.log("[SQLite] opened");

    const anyDb = dbObj as any;

    console.log("databaseFile =", anyDb.databaseFile);
    console.log("_dbFilename =", anyDb._dbFilename);
    console.log("_path =", anyDb._path);

    dbObj.transaction((tx) => {
      tx.executeSql("PRAGMA database_list", [], (tx, results) => {
        for (let i = 0; i < results.rows.length; i++) {
          const row = results.rows.item(i);
          console.log("[PRAGMA]", row);
        }
      });
    });

  },
  (err) => {
    console.log("[SQLite] open error:", err);
  }
 );

  console.log("DB opened at:", dbInstance.dbname);

  return dbInstance;
}

function formatSQLWithParams(sql: string, params: any[]): string {
  let formatted = sql;

  params.forEach((p, i) => {
    const safe =
      typeof p === "string"
        ? `'${p.replace(/'/g, "''")}'` // escape single quote
        : p === null || p === undefined
        ? "NULL"
        : p.toString();

    // แทน $1 หรือ ? หรือ :1
    formatted = formatted.replace("?", safe);
    formatted = formatted.replace(`$${i + 1}`, safe);
    formatted = formatted.replace(`:${i + 1}`, safe);
  });

  return formatted;
}

// helper รัน SQL แบบ promise
export async function runAsync(
  sql: string,
  params: any[] = []
): Promise<ResultSet> {
  const db = await getDb();

  const pretty = formatSQLWithParams(sql, params);
  console.log("[SQLite][runAsync] SQL =", pretty);

  return new Promise<ResultSet>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          sql,
          params,
          (_tx, result) => resolve(result),
          (_tx, err) => {
            console.warn("[SQLite] executeSql error", err);
            // ต้อง return false ให้ transaction รู้ว่า error แล้ว
            return false;
          }
        );
      },
      (err) => {
        // error ของ transaction เอง

        console.warn("[SQLite] transaction error", err, "\nSQL =", pretty);
        reject(err);
      }
    );
  });
}

export async function withTransactionAsync(
  fn: (tx: SQLite.Transaction) => void | Promise<void>
): Promise<void> {
  const db = await getDb();

  return new Promise<void>((resolve, reject) => {
    db.transaction(
      async (tx: any) => {
        try {
          // ⭐ wrap executeSql inside tx, so we add logging
          const oldExec = tx.executeSql.bind(tx);

          tx.executeSql = (sql: string, params?: any[], ...rest: any[]) => {
            const pretty = formatSQLWithParams(sql, params || []);
            console.log("[SQLite][tx] SQL =", pretty);
            return oldExec(sql, params, ...rest);
          };

          await fn(tx);
          resolve();
        } catch (e) {
          console.warn("[SQLite] withTransactionAsync error in fn", e);
          reject(e);
        }
      },
      (err) => {
        console.warn("[SQLite] withTransactionAsync transaction error", err);
        reject(err);
      }
    );
  });
}


// สร้างตารางต่าง ๆ
// src/lib/db.ts (เฉพาะ initDb ส่วนนี้)
export async function initDb() {
  // scam_phones
  await runAsync(`
    CREATE TABLE IF NOT EXISTS scam_phones (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_normalized  TEXT NOT NULL UNIQUE,
      report_count      INTEGER NOT NULL DEFAULT 0,
      last_report_at    TEXT,
      risk_level        INTEGER NOT NULL DEFAULT 0,
      tags              TEXT,
      server_updated_at TEXT NOT NULL,
      server_deleted    INTEGER NOT NULL DEFAULT 0,
      local_blocked     INTEGER NOT NULL DEFAULT 0   -- ⭐ เพิ่มตรงนี้
    );
  `);

  // กรณี DB เก่าเคยสร้างไปแล้ว แต่ยังไม่มี column local_blocked → ลอง ALTER เพิ่ม
  await runAsync(`
    PRAGMA table_info(scam_phones);
  `).then((res) => {
    const cols: any[] = res.rows.raw();
    const hasLocalBlocked = cols.some((c) => c.name === "local_blocked");
    if (!hasLocalBlocked) {
      return runAsync(
        `ALTER TABLE scam_phones ADD COLUMN local_blocked INTEGER NOT NULL DEFAULT 0;`
      );
    }
  }).catch(() => {
    // เผื่อ PRAGMA หรือ ALTER พัง ไม่ต้องทำอะไร ปล่อยผ่าน
  });

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_scam_phones_phone
    ON scam_phones(phone_normalized);
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_scam_phones_risk
    ON scam_phones(risk_level DESC);
  `);

  // notes
  await runAsync(`
    CREATE TABLE IF NOT EXISTS scam_phone_notes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_normalized TEXT NOT NULL,
      message          TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      created_by       TEXT,
      is_local_only    INTEGER NOT NULL DEFAULT 1
    );
  `);

  await runAsync(`
    CREATE INDEX IF NOT EXISTS idx_notes_phone
    ON scam_phone_notes(phone_normalized);
  `);

  // sync_state – มีแค่ 1 row
  await runAsync(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      last_full_sync_at  TEXT,
      last_delta_sync_at TEXT,
      last_version       TEXT,
      local_rows         INTEGER
    );
  `);

  // seed แถวแรก
  await runAsync(
    `
    INSERT OR IGNORE INTO sync_state (id, last_version, local_rows)
    VALUES (1, '0', 0);
  `
  );

  await runAsync(`
    CREATE TABLE IF NOT EXISTS blocked_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_normalized TEXT NOT NULL,
      raw_phone TEXT,
      type TEXT NOT NULL,               -- "call" | "sms"
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      detail TEXT                       -- optional: ใส่เหตุผลเพิ่ม
    );
  `);

}

