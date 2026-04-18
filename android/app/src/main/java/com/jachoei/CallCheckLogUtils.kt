package com.jachoei

import android.content.Context
import android.database.sqlite.SQLiteDatabase

object CallCheckLogUtils {
    private const val DB_NAME = "scam-protect.db"
    private const val TABLE = "call_check_logs"
    private const val MAX_LOGS = 1000

    data class CallCheckLogRow(
        val id: Long,
        val phoneOriginal: String,
        val phoneNormalized: String,
        val timestampMs: Long,
        val dbLookupStartedAtMs: Long,
        val dbLookupFinishedAtMs: Long,
        val tableQueried: String,
        val matchFound: Boolean,
        val localBlocked: Int,
        val globalRiskLevel: Int,
        val globalReportCount: Int,
        val matchedSource: String,
        val finalAction: String,
        val reason: String,
        val decisionExplanation: String,
        val normalizationVariantsChecked: String,
        val lookupDurationMs: Double,
        val deviceState: String,
        val serviceState: String,
        val createdAt: String,
    )

    data class CallCheckLogInput(
        val phoneOriginal: String,
        val phoneNormalized: String,
        val timestampMs: Long,
        val dbLookupStartedAtMs: Long,
        val dbLookupFinishedAtMs: Long,
        val tableQueried: String,
        val matchFound: Boolean,
        val localBlocked: Int,
        val globalRiskLevel: Int,
        val globalReportCount: Int,
        val matchedSource: String,
        val finalAction: String,
        val reason: String,
        val decisionExplanation: String,
        val normalizationVariantsChecked: String,
        val lookupDurationMs: Double,
        val deviceState: String,
        val serviceState: String,
    )

    fun ensureTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $TABLE (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              phone_original TEXT,
              phone_normalized TEXT,
              timestamp_ms INTEGER NOT NULL,
              db_lookup_started_at_ms INTEGER,
              db_lookup_finished_at_ms INTEGER,
              table_queried TEXT,
              match_found INTEGER NOT NULL DEFAULT 0,
              local_blocked INTEGER NOT NULL DEFAULT 0,
              global_risk_level INTEGER NOT NULL DEFAULT 0,
              global_report_count INTEGER NOT NULL DEFAULT 0,
              matched_source TEXT,
              final_action TEXT,
              reason TEXT,
              decision_explanation TEXT,
              normalization_variants_checked TEXT,
              lookup_duration_ms REAL,
              device_state TEXT,
              service_state TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS idx_call_check_logs_ts
            ON $TABLE(timestamp_ms DESC);
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS idx_call_check_logs_phone
            ON $TABLE(phone_normalized);
            """.trimIndent()
        )
    }

    private fun openDb(context: Context): SQLiteDatabase? {
        return try {
            val db = context.openOrCreateDatabase(DB_NAME, Context.MODE_PRIVATE, null)
            ensureTable(db)
            db
        } catch (_: Exception) {
            null
        }
    }

    private fun pruneOldRows(db: SQLiteDatabase) {
        db.execSQL(
            """
            DELETE FROM $TABLE
            WHERE id NOT IN (
              SELECT id FROM $TABLE ORDER BY id DESC LIMIT $MAX_LOGS
            );
            """.trimIndent()
        )
    }

    fun logCallCheck(context: Context, input: CallCheckLogInput) {
        try {
            val db = openDb(context) ?: return
            db.execSQL(
                """
                INSERT INTO $TABLE (
                  phone_original,
                  phone_normalized,
                  timestamp_ms,
                  db_lookup_started_at_ms,
                  db_lookup_finished_at_ms,
                  table_queried,
                  match_found,
                  local_blocked,
                  global_risk_level,
                  global_report_count,
                  matched_source,
                  final_action,
                  reason,
                  decision_explanation,
                  normalization_variants_checked,
                  lookup_duration_ms,
                  device_state,
                  service_state
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """.trimIndent(),
                arrayOf<Any?>(
                    input.phoneOriginal,
                    input.phoneNormalized,
                    input.timestampMs,
                    input.dbLookupStartedAtMs,
                    input.dbLookupFinishedAtMs,
                    input.tableQueried,
                    if (input.matchFound) 1 else 0,
                    input.localBlocked,
                    input.globalRiskLevel,
                    input.globalReportCount,
                    input.matchedSource,
                    input.finalAction,
                    input.reason,
                    input.decisionExplanation,
                    input.normalizationVariantsChecked,
                    input.lookupDurationMs,
                    input.deviceState,
                    input.serviceState,
                )
            )
            pruneOldRows(db)
            db.close()
        } catch (_: Exception) {
            // best-effort only
        }
    }

    fun listLogs(context: Context, limit: Int): List<CallCheckLogRow> {
        val out = ArrayList<CallCheckLogRow>()
        val safeLimit = Math.max(1, Math.min(limit, MAX_LOGS))
        val db = openDb(context) ?: return out

        try {
            val cursor = db.rawQuery(
                """
                SELECT
                  id,
                  phone_original,
                  phone_normalized,
                  timestamp_ms,
                  db_lookup_started_at_ms,
                  db_lookup_finished_at_ms,
                  table_queried,
                  match_found,
                  local_blocked,
                  global_risk_level,
                  global_report_count,
                  matched_source,
                  final_action,
                  reason,
                  decision_explanation,
                  normalization_variants_checked,
                  lookup_duration_ms,
                  device_state,
                  service_state,
                  created_at
                FROM $TABLE
                ORDER BY id DESC
                LIMIT ?
                """.trimIndent(),
                arrayOf(safeLimit.toString())
            )

            cursor.use { c ->
                while (c.moveToNext()) {
                    out.add(
                        CallCheckLogRow(
                            id = c.getLong(c.getColumnIndexOrThrow("id")),
                            phoneOriginal = c.getString(c.getColumnIndexOrThrow("phone_original")) ?: "",
                            phoneNormalized = c.getString(c.getColumnIndexOrThrow("phone_normalized")) ?: "",
                            timestampMs = if (!c.isNull(c.getColumnIndexOrThrow("timestamp_ms"))) c.getLong(c.getColumnIndexOrThrow("timestamp_ms")) else 0L,
                            dbLookupStartedAtMs = if (!c.isNull(c.getColumnIndexOrThrow("db_lookup_started_at_ms"))) c.getLong(c.getColumnIndexOrThrow("db_lookup_started_at_ms")) else 0L,
                            dbLookupFinishedAtMs = if (!c.isNull(c.getColumnIndexOrThrow("db_lookup_finished_at_ms"))) c.getLong(c.getColumnIndexOrThrow("db_lookup_finished_at_ms")) else 0L,
                            tableQueried = c.getString(c.getColumnIndexOrThrow("table_queried")) ?: "",
                            matchFound = (if (!c.isNull(c.getColumnIndexOrThrow("match_found"))) c.getInt(c.getColumnIndexOrThrow("match_found")) else 0) == 1,
                            localBlocked = if (!c.isNull(c.getColumnIndexOrThrow("local_blocked"))) c.getInt(c.getColumnIndexOrThrow("local_blocked")) else 0,
                            globalRiskLevel = if (!c.isNull(c.getColumnIndexOrThrow("global_risk_level"))) c.getInt(c.getColumnIndexOrThrow("global_risk_level")) else 0,
                            globalReportCount = if (!c.isNull(c.getColumnIndexOrThrow("global_report_count"))) c.getInt(c.getColumnIndexOrThrow("global_report_count")) else 0,
                            matchedSource = c.getString(c.getColumnIndexOrThrow("matched_source")) ?: "",
                            finalAction = c.getString(c.getColumnIndexOrThrow("final_action")) ?: "",
                            reason = c.getString(c.getColumnIndexOrThrow("reason")) ?: "",
                            decisionExplanation = c.getString(c.getColumnIndexOrThrow("decision_explanation")) ?: "",
                            normalizationVariantsChecked = c.getString(c.getColumnIndexOrThrow("normalization_variants_checked")) ?: "[]",
                            lookupDurationMs = if (!c.isNull(c.getColumnIndexOrThrow("lookup_duration_ms"))) c.getDouble(c.getColumnIndexOrThrow("lookup_duration_ms")) else 0.0,
                            deviceState = c.getString(c.getColumnIndexOrThrow("device_state")) ?: "",
                            serviceState = c.getString(c.getColumnIndexOrThrow("service_state")) ?: "",
                            createdAt = c.getString(c.getColumnIndexOrThrow("created_at")) ?: "",
                        )
                    )
                }
            }
        } catch (_: Exception) {
            // best-effort only
        } finally {
            try {
                db.close()
            } catch (_: Exception) {
                // ignore
            }
        }

        return out
    }

    fun clearLogs(context: Context): Int {
        val db = openDb(context) ?: return 0
        return try {
            val stmt = db.compileStatement("DELETE FROM $TABLE")
            val rows = stmt.executeUpdateDelete()
            db.close()
            rows
        } catch (_: Exception) {
            try {
                db.close()
            } catch (_: Exception) {
                // ignore
            }
            0
        }
    }

    fun count(context: Context): Int {
        val db = openDb(context) ?: return 0
        return try {
            val cursor = db.rawQuery("SELECT COUNT(*) AS c FROM $TABLE", null)
            val count = cursor.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
            }
            db.close()
            count
        } catch (_: Exception) {
            try {
                db.close()
            } catch (_: Exception) {
                // ignore
            }
            0
        }
    }
}
