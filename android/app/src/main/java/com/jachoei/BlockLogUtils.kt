package com.jachoei

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log

object BlockLogUtils {

    private const val TAG = "JACHOEI_CALL"
    private const val TRACE_TAG = "CALL_LOG_DB"
    private const val DB_NAME = "scam-protect.db"

    private fun ensureBlockedLogsTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS blocked_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              phone_normalized TEXT NOT NULL,
              raw_phone TEXT,
              type TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              detail TEXT
            );
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS idx_blocked_logs_phone_time
            ON blocked_logs(phone_normalized, datetime(created_at) DESC);
            """.trimIndent()
        )
    }

    private fun openDb(context: Context): SQLiteDatabase? {
        return try {
            Log.d(TRACE_TAG, "openDb()")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB openDb()")
            val db = context.openOrCreateDatabase(DB_NAME, Context.MODE_PRIVATE, null)
            ensureBlockedLogsTable(db)
            Log.d(TRACE_TAG, "openDb() OK")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB openDb() OK")
            db
        } catch (e: Exception) {
            Log.e(TAG, "[openDb] error", e)
            Log.d(TRACE_TAG, "openDb() ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB openDb() ERROR: ${e.message}")
            null
        }
    }

    private fun jsonEscape(v: String): String {
        return v.replace("\\", "\\\\").replace("\"", "\\\"")
    }

    private fun buildDetailJson(
        action: String,
        source: String,
        matchedBy: String?,
        riskLevel: Int?,
        note: String?
    ): String {
        val mb = matchedBy?.let { "\"matched_by\":\"${jsonEscape(it)}\"," } ?: ""
        val risk = riskLevel?.let { "\"risk\":$it," } ?: ""
        val n = note?.let { "\"note\":\"${jsonEscape(it)}\"," } ?: ""
        return "{\"action\":\"${jsonEscape(action)}\",\"source\":\"${jsonEscape(source)}\",${mb}${risk}${n}\"v\":1}"
    }

    fun logEvent(
        context: Context,
        phone: String,
        rawPhone: String?,
        type: String,
        source: String,
        action: String,
        matchedBy: String? = null,
        riskLevel: Int? = null,
        note: String? = null,
        dedupWindowSec: Int = 25,
    ) {
        try {
            Log.d(TRACE_TAG, "logEvent() phone=$phone type=$type source=$source action=$action")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB logEvent phone=$phone type=$type source=$source action=$action")
            val db = openDb(context) ?: return

            val detail = buildDetailJson(action, source, matchedBy, riskLevel, note)
            val win = Math.max(5, Math.min(dedupWindowSec, 120))

            // best-effort dedup: same phone+type+action+source within a short window
            val cursor = db.rawQuery(
                """
                SELECT 1
                FROM blocked_logs
                WHERE phone_normalized = ?
                  AND type = ?
                  AND detail LIKE ?
                  AND datetime(created_at) >= datetime('now', '-' || ? || ' seconds')
                LIMIT 1
                """.trimIndent(),
                                arrayOf(phone, type, "%\"action\":\"$action\"%\"source\":\"$source\"%", win.toString())
            )

            cursor.use { c ->
                if (c.moveToFirst()) {
                    Log.d(TRACE_TAG, "dedup HIT -> skip insert")
                    CallBlockerModule.emitCallDebug("CALL_LOG_DB dedup HIT -> skip")
                    db.close()
                    return
                }
            }

            db.execSQL(
                """
                INSERT INTO blocked_logs (phone_normalized, raw_phone, type, detail)
                VALUES (?,?,?,?)
                """.trimIndent(),
                arrayOf(phone, rawPhone, type, detail)
            )
            db.close()
            Log.d(TRACE_TAG, "inserted")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB inserted")
        } catch (e: Exception) {
            Log.e(TAG, "logEvent error", e)
            Log.d(TRACE_TAG, "logEvent() ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug("CALL_LOG_DB ERROR: ${e.message}")
        }
    }

    // Backward-compatible wrapper
    fun logBlocked(context: Context, phone: String, rawPhone: String?, type: String, detail: String? = null) {
        logEvent(
            context = context,
            phone = phone,
            rawPhone = rawPhone,
            type = type,
            source = "unknown",
            action = "allowed",
            matchedBy = null,
            riskLevel = null,
            note = detail,
            dedupWindowSec = 10
        )
    }
}
