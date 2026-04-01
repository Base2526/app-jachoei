package com.jachoei

import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.*
import android.util.Log
import android.content.Context
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import java.util.ArrayDeque

class CallBlockerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "JACHOEI_CALL"
        private const val TRACE_TAG = "CALL_BLOCKER_MODULE"
        private const val DB_NAME = "scam-protect.db"

        // Toggle: production-safe default (only emits in DEBUG builds)
        private val DEBUG_CALL: Boolean = BuildConfig.DEBUG

        private const val DEBUG_EVENT_NAME = "CALL_DEBUG_EVENT"

        private var reactCtxRef: WeakReference<ReactApplicationContext>? = null

        private data class DebugEvent(
            val ts: Double,
            val msg: String,
            val source: String,
            val rawNumber: String? = null,
            val normalizedNumber: String? = null,
            val matchedBlocked: Boolean? = null,
            val matchedSpam: Boolean? = null,
            val action: String? = null,
            // Optional verbose DB lookup details (debug-only emitters decide what to populate)
            val dbName: String? = null,
            val dbPath: String? = null,
            val table: String? = null,
            val query: String? = null,
            val queryArgs: List<String>? = null,
            val variants: List<String>? = null,
            val rowsFound: Int? = null,
            val matchedRow: Map<String, Any?>? = null,
            val riskLevel: Int? = null,
            val localBlocked: Boolean? = null,
            val serverDeleted: Boolean? = null,
            val finalDecision: String? = null,
            val lookupDurationMs: Double? = null,
        )

        // Buffer events because CallScreeningService may run when JS bridge isn't ready.
        // Keep it bounded to avoid memory growth.
        private val debugBuffer: ArrayDeque<DebugEvent> = ArrayDeque()
        private const val DEBUG_BUFFER_MAX = 200

        @Synchronized
        private fun bufferDebug(ev: DebugEvent) {
            if (!DEBUG_CALL) return
            debugBuffer.addLast(ev)
            while (debugBuffer.size > DEBUG_BUFFER_MAX) debugBuffer.removeFirst()
        }

        private fun putStringArray(params: WritableMap, key: String, values: List<String>?) {
            if (values == null) return
            val arr = Arguments.createArray()
            for (v in values) {
                arr.pushString(v)
            }
            params.putArray(key, arr)
        }

        private fun putAnyMap(params: WritableMap, key: String, values: Map<String, Any?>?) {
            if (values == null) return
            val m = Arguments.createMap()
            for ((k, v) in values) {
                when (v) {
                    null -> m.putNull(k)
                    is String -> m.putString(k, v)
                    is Boolean -> m.putBoolean(k, v)
                    is Int -> m.putInt(k, v)
                    is Double -> m.putDouble(k, v)
                    is Float -> m.putDouble(k, v.toDouble())
                    is Long -> m.putDouble(k, v.toDouble())
                    else -> {
                        // ignore unsupported types
                    }
                }
            }
            params.putMap(key, m)
        }

        private fun tryEmitDebug(ctx: ReactApplicationContext, ev: DebugEvent) {
            if (!DEBUG_CALL) return
            try {
                // Best-effort only; must never crash background services.
                if (!ctx.hasActiveCatalystInstance()) return

                val params = Arguments.createMap()

                // Required structured payload
                params.putDouble("ts", ev.ts)
                params.putString("msg", ev.msg)
                params.putString("source", ev.source)
                if (!ev.rawNumber.isNullOrBlank()) params.putString("rawNumber", ev.rawNumber)
                if (!ev.normalizedNumber.isNullOrBlank()) params.putString("normalizedNumber", ev.normalizedNumber)
                if (ev.matchedBlocked != null) params.putBoolean("matchedBlocked", ev.matchedBlocked)
                if (ev.matchedSpam != null) params.putBoolean("matchedSpam", ev.matchedSpam)
                if (!ev.action.isNullOrBlank()) params.putString("action", ev.action)

                // Optional DB metadata (only set when provided)
                if (!ev.dbName.isNullOrBlank()) params.putString("dbName", ev.dbName)
                if (!ev.dbPath.isNullOrBlank()) params.putString("dbPath", ev.dbPath)
                if (!ev.table.isNullOrBlank()) params.putString("table", ev.table)
                if (!ev.query.isNullOrBlank()) params.putString("query", ev.query)
                putStringArray(params, "queryArgs", ev.queryArgs)
                putStringArray(params, "variants", ev.variants)
                if (ev.rowsFound != null) params.putInt("rowsFound", ev.rowsFound)
                putAnyMap(params, "matchedRow", ev.matchedRow)
                if (ev.riskLevel != null) params.putInt("riskLevel", ev.riskLevel)
                if (ev.localBlocked != null) params.putBoolean("localBlocked", ev.localBlocked)
                if (ev.serverDeleted != null) params.putBoolean("serverDeleted", ev.serverDeleted)
                if (!ev.finalDecision.isNullOrBlank()) params.putString("finalDecision", ev.finalDecision)
                if (ev.lookupDurationMs != null) params.putDouble("lookupDurationMs", ev.lookupDurationMs)

                // Backward-compatible fields used by existing JS
                params.putString("message", "${ev.source} ${ev.msg}".trim())
                params.putDouble("timestamp", ev.ts)

                ctx
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(DEBUG_EVENT_NAME, params)
            } catch (_: Exception) {
                // best-effort only
            }
        }

        private fun parseSourceAndMsg(message: String): Pair<String, String> {
            val trimmed = message.trim()
            if (trimmed.isEmpty()) return Pair("UNKNOWN", "(empty)")
            val idx = trimmed.indexOf(' ')
            if (idx <= 0) return Pair("UNKNOWN", trimmed)
            val source = trimmed.substring(0, idx).trim()
            val msg = trimmed.substring(idx + 1).trim()
            return Pair(source.ifEmpty { "UNKNOWN" }, msg.ifEmpty { "(empty)" })
        }

        /**
         * Global debug bridge for native code.
         * Safe in background/killed: buffers until the React context is available.
         */
        fun emitCallDebug(
            source: String,
            msg: String,
            rawNumber: String? = null,
            normalizedNumber: String? = null,
            matchedBlocked: Boolean? = null,
            matchedSpam: Boolean? = null,
            action: String? = null,
            dbName: String? = null,
            dbPath: String? = null,
            table: String? = null,
            query: String? = null,
            queryArgs: List<String>? = null,
            variants: List<String>? = null,
            rowsFound: Int? = null,
            matchedRow: Map<String, Any?>? = null,
            riskLevel: Int? = null,
            localBlocked: Boolean? = null,
            serverDeleted: Boolean? = null,
            finalDecision: String? = null,
            lookupDurationMs: Double? = null,
        ) {
            if (!DEBUG_CALL) return
            val ev = DebugEvent(
                ts = System.currentTimeMillis().toDouble(),
                source = source.ifBlank { "UNKNOWN" },
                msg = msg.ifBlank { "(empty)" },
                rawNumber = rawNumber,
                normalizedNumber = normalizedNumber,
                matchedBlocked = matchedBlocked,
                matchedSpam = matchedSpam,
                action = action,
                dbName = dbName,
                dbPath = dbPath,
                table = table,
                query = query,
                queryArgs = queryArgs,
                variants = variants,
                rowsFound = rowsFound,
                matchedRow = matchedRow,
                riskLevel = riskLevel,
                localBlocked = localBlocked,
                serverDeleted = serverDeleted,
                finalDecision = finalDecision,
                lookupDurationMs = lookupDurationMs,
            )

            bufferDebug(ev)
            val ctx = reactCtxRef?.get() ?: return
            tryEmitDebug(ctx, ev)
        }

        /**
         * Backward-compatible debug bridge.
         * Accepts "SOURCE message" and auto-populates the structured payload.
         */
        fun emitCallDebug(message: String) {
            if (!DEBUG_CALL) return
            val (source, msg) = parseSourceAndMsg(message)
            emitCallDebug(source = source, msg = msg)
        }

        @Synchronized
        private fun flushDebugBufferLocked(ctx: ReactApplicationContext) {
            if (!DEBUG_CALL) return
            while (debugBuffer.isNotEmpty()) {
                val ev = debugBuffer.removeFirst()
                tryEmitDebug(ctx, ev)
            }
        }

        fun emitIncomingSpamCall(phoneNormalized: String, risk: Int, rawPhone: String?) {
            try {
                Log.d(TRACE_TAG, "emitIncomingSpamCall() phone=$phoneNormalized risk=$risk raw=$rawPhone")
                emitCallDebug(
                    source = "SPAM_WARNING_TRIGGER",
                    msg = "emitIncomingSpamCall(risk=$risk)",
                    rawNumber = rawPhone,
                    normalizedNumber = phoneNormalized,
                    matchedSpam = true,
                    action = "EMIT_INCOMING_SPAM_CALL_EVENT",
                )
                val ctx = reactCtxRef?.get() ?: return
                val payload = Arguments.createMap()
                payload.putString("phone_normalized", phoneNormalized)
                payload.putInt("risk", risk)
                payload.putString("raw_phone", rawPhone)
                ctx
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onIncomingSpamCall", payload)
            } catch (_: Exception) {
                // best-effort only
            }
        }
    }

    init {
        reactCtxRef = WeakReference(reactContext)

        // Provide app context for notification utilities.
        try {
            JachoeiNotificationUtils.init(reactContext)
        } catch (_: Exception) {
            // best-effort only
        }

        // Flush buffered native debug events as soon as the bridge is ready.
        try {
            flushDebugBufferLocked(reactContext)
        } catch (_: Exception) {
            // ignore
        }
    }

    override fun getName(): String = "CallBlocker"

    private fun ensureScamPhonesTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS scam_phones (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              phone_normalized  TEXT NOT NULL UNIQUE,
              report_count      INTEGER NOT NULL DEFAULT 0,
              last_report_at    TEXT,
              risk_level        INTEGER NOT NULL DEFAULT 0,
              tags              TEXT,
              server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              server_deleted    INTEGER NOT NULL DEFAULT 0,
              local_blocked     INTEGER NOT NULL DEFAULT 0
            );
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_scam_phones_phone ON scam_phones(phone_normalized);")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_scam_phones_risk ON scam_phones(risk_level DESC);")
    }

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
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_blocked_logs_phone_time ON blocked_logs(phone_normalized, datetime(created_at) DESC);")
    }

    /** เปิด DB scam-protect.db */
    private fun openDb(): SQLiteDatabase? {
        return try {
            Log.d(TRACE_TAG, "openDb()")
            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "openDb ENTER (reactContext.openOrCreateDatabase)",
                action = "OPEN_DB_ENTER",
            )
            val db = reactContext.openOrCreateDatabase(DB_NAME, Context.MODE_PRIVATE, null)
            ensureScamPhonesTable(db)
            ensureBlockedLogsTable(db)
            Log.d(TRACE_TAG, "openDb() OK")
            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "openDb OK",
                action = "OPEN_DB_OK",
            )
            db
        } catch (e: Exception) {
            Log.e(TAG, "[openDb] error", e)
            Log.d(TRACE_TAG, "openDb() ERROR: ${e.message}")
            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "openDb ERROR: ${e.message}",
                action = "OPEN_DB_ERROR",
            )
            null
        }
    }

    // ========================
    // Add Block Number
    // ========================
    @ReactMethod
    fun addBlockedNumber(phoneRaw: String, promise: Promise) {
        Log.d(TRACE_TAG, "addBlockedNumber() raw=$phoneRaw")
        Log.d(TAG, "===== addBlockedNumber() =====")
        Log.d(TAG, "[input] raw = '$phoneRaw'")
        emitCallDebug("CALL_BLOCKER_MODULE addBlockedNumber raw=$phoneRaw")

        try {
            val phone = PhoneUtils.normalize(phoneRaw)
            val variants = PhoneUtils.variants(phone)
            Log.d(TAG, "[normalize] phone = '$phone' variants=${variants.size}")

            val db = openDb()
            if (db == null) {
                val msg = "Database not found"
                Log.e(TAG, "[addBlockedNumber] $msg")
                promise.reject("DB_NOT_FOUND", msg)
                return
            }

            db.beginTransaction()
            try {
                Log.d(TAG, "[SQL] INSERT OR IGNORE scam_phones ($phone)")

                db.execSQL(
                    """
                    INSERT OR IGNORE INTO scam_phones (phone_normalized, server_updated_at)
                    VALUES (?, datetime('now'))
                    """.trimIndent(),
                    arrayOf(phone)
                )

                Log.d(TAG, "[SQL] UPDATE local_blocked = 1")

                val placeholders = variants.joinToString(",") { "?" }
                db.execSQL(
                    """
                    UPDATE scam_phones
                    SET local_blocked = 1
                    WHERE (local_blocked IS NULL OR local_blocked = 0)
                      AND phone_normalized IN ($placeholders)
                    """.trimIndent(),
                    variants
                )

                val updated = try {
                    val c = db.rawQuery("SELECT changes()", null)
                    c.use { cur -> if (cur.moveToFirst() && !cur.isNull(0)) cur.getInt(0) else 0 }
                } catch (_: Exception) {
                    0
                }

                db.setTransactionSuccessful()
                Log.d(TAG, "[SUCCESS] '$phone' is now BLOCKED")

                // Notify only when we actually toggled local_blocked from 0 -> 1.
                if (updated > 0) {
                    JachoeiNotificationUtils.showLocalBlockNotification(phone)
                    emitCallDebug(
                        source = "BLOCK_ACTION",
                        msg = "local block success -> notification shown",
                        normalizedNumber = phone,
                        action = "LOCAL_BLOCK_NOTIFY",
                    )
                }

                promise.resolve(true)

            } finally {
                db.endTransaction()
                db.close()
            }

        } catch (e: Exception) {
            Log.e(TAG, "[addBlockedNumber] ERROR", e)
            promise.reject("ADD_BLOCK_ERROR", e)
        }
    }

    // ========================
    // Remove Block Number
    // ========================
    @ReactMethod
    fun removeBlockedNumber(phoneRaw: String, promise: Promise) {
        Log.d(TRACE_TAG, "removeBlockedNumber() raw=$phoneRaw")
        Log.d(TAG, "===== removeBlockedNumber() =====")
        Log.d(TAG, "[input] raw = '$phoneRaw'")
        emitCallDebug("CALL_BLOCKER_MODULE removeBlockedNumber raw=$phoneRaw")

        try {
            val phone = PhoneUtils.normalize(phoneRaw)
            val variants = PhoneUtils.variants(phone)
            Log.d(TAG, "[normalize] phone = '$phone' variants=${variants.size}")

            val db = openDb()
            if (db == null) {
                val msg = "Database not found"
                Log.e(TAG, "[removeBlockedNumber] $msg")
                promise.reject("DB_NOT_FOUND", msg)
                return
            }

            db.beginTransaction()
            try {
                Log.d(TAG, "[SQL] UPDATE local_blocked = 0")

                val placeholders = variants.joinToString(",") { "?" }
                db.execSQL(
                    """
                    UPDATE scam_phones
                    SET local_blocked = 0
                    WHERE phone_normalized IN ($placeholders)
                    """.trimIndent(),
                    variants
                )

                db.setTransactionSuccessful()
                Log.d(TAG, "[SUCCESS] '$phone' is now UNBLOCKED")
                promise.resolve(true)

            } finally {
                db.endTransaction()
                db.close()
            }

        } catch (e: Exception) {
            Log.e(TAG, "[removeBlockedNumber] ERROR", e)
            promise.reject("REMOVE_BLOCK_ERROR", e)
        }
    }

    // ========================
    // List Blocked Numbers
    // ========================
    @ReactMethod
    fun listBlockedNumbers(promise: Promise) {
        Log.d(TRACE_TAG, "listBlockedNumbers()")
        Log.d(TAG, "===== listBlockedNumbers() =====")
        emitCallDebug("CALL_BLOCKER_MODULE listBlockedNumbers")

        try {
            val db = openDb()
            if (db == null) {
                val msg = "Database not found"
                Log.e(TAG, "[listBlockedNumbers] $msg")
                promise.reject("DB_NOT_FOUND", msg)
                return
            }

            val arr = WritableNativeArray()

            Log.d(TAG, "[SQL] SELECT phone_normalized FROM scam_phones WHERE local_blocked = 1")

            val cursor = db.rawQuery(
                """
                SELECT phone_normalized
                FROM scam_phones
                WHERE local_blocked = 1
                ORDER BY phone_normalized ASC
                """.trimIndent(),
                emptyArray()
            )

            cursor.use { c ->
                while (c.moveToNext()) {
                    val phone =
                        c.getString(c.getColumnIndexOrThrow("phone_normalized"))
                    Log.d(TAG, "[BLOCKED] $phone")
                    arr.pushString(phone)
                }
            }

            db.close()

            Log.d(TAG, "[RESULT] total=${arr.size()}")
            promise.resolve(arr)

        } catch (e: Exception) {
            Log.e(TAG, "[listBlockedNumbers] ERROR", e)
            promise.reject("LIST_BLOCK_ERROR", e)
        }
    }

    // ========================
    // DEBUG: Native blocked/spam rows for UI inspection
    // local_blocked = 1 OR risk_level >= 60
    // ========================
    @ReactMethod
    fun getNativeBlockedList(promise: Promise) {
        val dbFile = reactContext.getDatabasePath(DB_NAME)
        val dbPath = dbFile.absolutePath

        val out = Arguments.createMap()
        out.putString("dbPath", dbPath)
        out.putString("dbName", DB_NAME)
        out.putString("table", "scam_phones")
        out.putInt("total", 0)
        out.putArray("rows", Arguments.createArray())

        // Debug-only: keep production risk minimal.
        if (!BuildConfig.DEBUG) {
            promise.resolve(out)
            return
        }

        emitCallDebug(
            source = "DB_LOOKUP",
            msg = "getNativeBlockedList ENTER",
            dbName = DB_NAME,
            dbPath = dbPath,
            table = "scam_phones",
            action = "NATIVE_BLOCKED_LIST_ENTER",
        )

        try {
            if (!dbFile.exists()) {
                emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "getNativeBlockedList DB_NOT_FOUND",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = "scam_phones",
                    action = "NATIVE_BLOCKED_LIST_DB_NOT_FOUND",
                )
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                promise.resolve(out)
                return
            }

            val rows = Arguments.createArray()

            val sql = """
                SELECT phone_normalized, risk_level, local_blocked, server_deleted
                FROM scam_phones
                WHERE server_deleted = 0
                  AND (local_blocked = 1 OR risk_level >= 60)
                ORDER BY local_blocked DESC, risk_level DESC
                LIMIT 100
                """.trimIndent()

            val cursor = db.rawQuery(sql, emptyArray())
            cursor.use { c ->
                while (c.moveToNext()) {
                    val m = Arguments.createMap()
                    val phone = c.getString(c.getColumnIndexOrThrow("phone_normalized"))
                    val risk = c.getInt(c.getColumnIndexOrThrow("risk_level"))
                    val local = c.getInt(c.getColumnIndexOrThrow("local_blocked"))
                    val deleted = c.getInt(c.getColumnIndexOrThrow("server_deleted"))

                    m.putString("phone", phone)
                    m.putInt("riskLevel", risk)
                    m.putBoolean("localBlocked", local == 1)
                    m.putInt("serverDeleted", deleted)
                    rows.pushMap(m)
                }
            }

            db.close()

            out.putInt("total", rows.size())
            out.putArray("rows", rows)

            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "getNativeBlockedList RESULT count=${rows.size()}",
                dbName = DB_NAME,
                dbPath = dbPath,
                table = "scam_phones",
                rowsFound = rows.size(),
                action = "NATIVE_BLOCKED_LIST_RESULT",
            )

            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "[getNativeBlockedList] ERROR", e)
            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "getNativeBlockedList ERROR: ${e.message}",
                dbName = DB_NAME,
                dbPath = dbPath,
                table = "scam_phones",
                action = "NATIVE_BLOCKED_LIST_ERROR",
            )
            promise.resolve(out)
        }
    }

    // ========================
    // DEBUG: Full native DB inspection payload
    // Separates LOCAL vs GLOBAL records from scam_phones
    // ========================
    @ReactMethod
    fun getNativeBlockDebugData(promise: Promise) {
        val dbFile = reactContext.getDatabasePath(DB_NAME)
        val dbPath = dbFile.absolutePath
        val table = "scam_phones"

        val out = Arguments.createMap()
        out.putString("dbName", DB_NAME)
        out.putString("dbPath", dbPath)
        out.putInt("totalCount", 0)
        out.putInt("localCount", 0)
        out.putInt("globalCount", 0)
        out.putArray("local", Arguments.createArray())
        out.putArray("global", Arguments.createArray())

        // Debug-only: keep production risk minimal.
        if (!BuildConfig.DEBUG) {
            promise.resolve(out)
            return
        }

        fun readTableColumns(db: SQLiteDatabase, tableName: String): Set<String> {
            val cols = LinkedHashSet<String>()
            val c = db.rawQuery("PRAGMA table_info($tableName)", null)
            c.use { cur ->
                val nameIdx = cur.getColumnIndex("name")
                while (cur.moveToNext()) {
                    if (nameIdx >= 0 && !cur.isNull(nameIdx)) {
                        cols.add(cur.getString(nameIdx))
                    }
                }
            }
            return cols
        }

        fun pickPhoneColumn(cols: Set<String>): String? {
            if (cols.contains("phone_normalized")) return "phone_normalized"
            if (cols.contains("phone")) return "phone"
            if (cols.contains("phoneNumber")) return "phoneNumber"
            if (cols.contains("number")) return "number"
            return null
        }

        fun countWhere(db: SQLiteDatabase, whereSql: String): Int {
            val cur = db.rawQuery("SELECT COUNT(*) AS c FROM $table WHERE $whereSql", null)
            cur.use { c ->
                return if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
            }
        }

        fun queryRows(db: SQLiteDatabase, cols: Set<String>, whereSql: String, limit: Int): WritableArray {
            val phoneCol = pickPhoneColumn(cols)
            if (phoneCol.isNullOrBlank()) return Arguments.createArray()

            val selectCols = ArrayList<String>()
            selectCols.add(phoneCol)

            if (cols.contains("risk_level")) selectCols.add("risk_level")
            if (cols.contains("local_blocked")) selectCols.add("local_blocked")
            if (cols.contains("server_deleted")) selectCols.add("server_deleted")
            if (cols.contains("report_count")) selectCols.add("report_count")
            if (cols.contains("last_report_at")) selectCols.add("last_report_at")
            if (cols.contains("tags")) selectCols.add("tags")
            if (cols.contains("raw_phone")) selectCols.add("raw_phone")
            if (cols.contains("rawPhone")) selectCols.add("rawPhone")

            val order = when {
                cols.contains("risk_level") -> "risk_level DESC, $phoneCol ASC"
                else -> "$phoneCol ASC"
            }

            val sql = "SELECT ${selectCols.joinToString(", ")} FROM $table WHERE $whereSql ORDER BY $order LIMIT $limit"
            val arr = Arguments.createArray()

            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                val idxPhone = c.getColumnIndex(phoneCol)
                val idxRisk = c.getColumnIndex("risk_level")
                val idxLocal = c.getColumnIndex("local_blocked")
                val idxDeleted = c.getColumnIndex("server_deleted")
                val idxReportCount = c.getColumnIndex("report_count")
                val idxLastReportAt = c.getColumnIndex("last_report_at")
                val idxTags = c.getColumnIndex("tags")
                val idxRawPhone = if (cols.contains("raw_phone")) c.getColumnIndex("raw_phone") else c.getColumnIndex("rawPhone")

                while (c.moveToNext()) {
                    val m = Arguments.createMap()

                    val phone = if (idxPhone >= 0 && !c.isNull(idxPhone)) c.getString(idxPhone) else ""
                    val risk = if (idxRisk >= 0 && !c.isNull(idxRisk)) c.getInt(idxRisk) else 0
                    val local = if (idxLocal >= 0 && !c.isNull(idxLocal)) c.getInt(idxLocal) else 0
                    val deleted = if (idxDeleted >= 0 && !c.isNull(idxDeleted)) c.getInt(idxDeleted) else 0

                    m.putString("phone", phone)
                    if (idxRawPhone >= 0 && !c.isNull(idxRawPhone)) m.putString("rawPhone", c.getString(idxRawPhone))
                    m.putInt("riskLevel", risk)
                    m.putBoolean("localBlocked", local == 1)
                    m.putInt("serverDeleted", deleted)

                    if (idxReportCount >= 0 && !c.isNull(idxReportCount)) m.putInt("reportCount", c.getInt(idxReportCount))
                    if (idxLastReportAt >= 0 && !c.isNull(idxLastReportAt)) m.putString("lastReportAt", c.getString(idxLastReportAt))
                    if (idxTags >= 0 && !c.isNull(idxTags)) m.putString("tags", c.getString(idxTags))

                    arr.pushMap(m)
                }
            }

            return arr
        }

        try {
            if (!dbFile.exists()) {
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                promise.resolve(out)
                return
            }

            val columns = readTableColumns(db, table)
            val hasLocalBlocked = columns.contains("local_blocked")
            val hasServerDeleted = columns.contains("server_deleted")

            val localWhere = if (hasLocalBlocked) {
                "local_blocked = 1"
            } else {
                "1 = 0"
            }

            val globalWhere = buildString {
                if (hasLocalBlocked) append("(local_blocked IS NULL OR local_blocked = 0)") else append("1 = 1")
                if (hasServerDeleted) append(" AND server_deleted = 0")
            }

            val localCount = try { countWhere(db, localWhere) } catch (_: Exception) { 0 }
            val globalCount = try { countWhere(db, globalWhere) } catch (_: Exception) { 0 }
            val totalCount = localCount + globalCount

            // Render limit to keep UI responsive; counts still reflect full totals.
            val limit = 5000
            val localRows = try { queryRows(db, columns, localWhere, limit) } catch (_: Exception) { Arguments.createArray() }
            val globalRows = try { queryRows(db, columns, globalWhere, limit) } catch (_: Exception) { Arguments.createArray() }

            db.close()

            out.putInt("totalCount", totalCount)
            out.putInt("localCount", localCount)
            out.putInt("globalCount", globalCount)
            out.putArray("local", localRows)
            out.putArray("global", globalRows)

            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "[getNativeBlockDebugData] ERROR", e)
            promise.resolve(out)
        }
    }

    // ========================
    // DEBUG: Unblock a locally-blocked number (clears local_blocked)
    // ========================
    @ReactMethod
    fun unblockNativeNumber(phone: String, promise: Promise) {
        val dbFile = reactContext.getDatabasePath(DB_NAME)
        val dbPath = dbFile.absolutePath
        val table = "scam_phones"

        val out = Arguments.createMap()
        out.putBoolean("ok", false)
        out.putString("dbName", DB_NAME)
        out.putString("dbPath", dbPath)
        out.putString("phone", phone)

        // Debug-only: keep production risk minimal.
        if (!BuildConfig.DEBUG) {
            promise.resolve(out)
            return
        }

        fun readTableColumns(db: SQLiteDatabase, tableName: String): Set<String> {
            val cols = LinkedHashSet<String>()
            val c = db.rawQuery("PRAGMA table_info($tableName)", null)
            c.use { cur ->
                val nameIdx = cur.getColumnIndex("name")
                while (cur.moveToNext()) {
                    if (nameIdx >= 0 && !cur.isNull(nameIdx)) {
                        cols.add(cur.getString(nameIdx))
                    }
                }
            }
            return cols
        }

        fun pickPhoneColumn(cols: Set<String>): String? {
            if (cols.contains("phone_normalized")) return "phone_normalized"
            if (cols.contains("phone")) return "phone"
            if (cols.contains("phoneNumber")) return "phoneNumber"
            if (cols.contains("number")) return "number"
            return null
        }

        try {
            val input = phone.trim()
            val canonical = PhoneUtils.normalize(input)
            val variants = if (canonical.isNotEmpty()) PhoneUtils.variants(canonical).toList() else emptyList()

            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "unblockNativeNumber ENTER input=$input canonical=$canonical variants=${variants.size}",
                dbName = DB_NAME,
                dbPath = dbPath,
                table = table,
                action = "UNBLOCK_ENTER",
            )

            if (input.isEmpty()) {
                out.putString("error", "empty phone")
                promise.resolve(out)
                return
            }

            if (!dbFile.exists()) {
                out.putString("error", "db not found")
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                out.putString("error", "db open failed")
                promise.resolve(out)
                return
            }

            val cols = readTableColumns(db, table)
            val phoneCol = pickPhoneColumn(cols)
            val hasLocalBlocked = cols.contains("local_blocked")

            if (phoneCol.isNullOrBlank() || !hasLocalBlocked) {
                out.putString("error", "required columns missing")
                db.close()
                promise.resolve(out)
                return
            }

            val valuesToMatch = ArrayList<String>()
            valuesToMatch.add(input)
            for (v in variants) valuesToMatch.add(v)

            val uniq = LinkedHashSet<String>()
            for (v in valuesToMatch) {
                val s = v.trim()
                if (s.isNotEmpty()) uniq.add(s)
                if (uniq.size >= 12) break
            }
            val matchList = uniq.toList()

            db.beginTransaction()
            try {
                val placeholders = matchList.joinToString(",") { "?" }
                val sql = "UPDATE $table SET local_blocked = 0 WHERE $phoneCol IN ($placeholders)"
                val stmt = db.compileStatement(sql)
                for ((i, v) in matchList.withIndex()) {
                    stmt.bindString(i + 1, v)
                }
                stmt.execute()

                val changesCur = db.rawQuery("SELECT changes()", null)
                val updated = changesCur.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0 }

                db.setTransactionSuccessful()

                out.putBoolean("ok", true)
                out.putString("canonical", canonical)
                out.putInt("updated", updated)
                out.putArray("matched", Arguments.fromList(matchList))

                emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "unblockNativeNumber OK updated=$updated canonical=$canonical",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = table,
                    action = "UNBLOCK_OK",
                    rowsFound = updated,
                )
            } finally {
                db.endTransaction()
                db.close()
            }

            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "[unblockNativeNumber] ERROR", e)
            out.putString("error", e.message ?: "unknown")
            emitCallDebug(
                source = "DB_LOOKUP",
                msg = "unblockNativeNumber ERROR: ${e.message}",
                dbName = DB_NAME,
                dbPath = dbPath,
                table = table,
                action = "UNBLOCK_ERROR",
            )
            promise.resolve(out)
        }
    }

    // ========================
    // Spec-required: syncBlockedNumbers
    // ========================
    @ReactMethod
    fun syncBlockedNumbers(numbers: ReadableArray, promise: Promise) {
        Log.d(TRACE_TAG, "syncBlockedNumbers() size=${numbers.size()}")
        emitCallDebug("CALL_BLOCKER_MODULE syncBlockedNumbers size=${numbers.size()}")
        try {
            val db = openDb() ?: run {
                promise.reject("DB_NOT_FOUND", "Database not found")
                return
            }

            db.beginTransaction()
            try {
                for (i in 0 until numbers.size()) {
                    val raw = numbers.getString(i)
                    val phone = PhoneUtils.normalize(raw)
                    if (phone.isEmpty()) continue

                    db.execSQL(
                        """
                        INSERT OR IGNORE INTO scam_phones (phone_normalized, server_updated_at)
                        VALUES (?, datetime('now'))
                        """.trimIndent(),
                        arrayOf(phone)
                    )

                    db.execSQL(
                        """
                        UPDATE scam_phones
                        SET local_blocked = 1
                        WHERE (local_blocked IS NULL OR local_blocked = 0)
                          AND phone_normalized = ?
                        """.trimIndent(),
                        arrayOf(phone)
                    )
                }

                db.setTransactionSuccessful()
                promise.resolve(true)
            } finally {
                db.endTransaction()
                db.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[syncBlockedNumbers] ERROR", e)
            promise.reject("SYNC_BLOCKED_ERROR", e)
        }
    }

    // ========================
    // Spec-required: syncSpamNumbers
    // Each item: { phone: string, risk_level?: number, server_deleted?: number, updated_at?: string }
    // ========================
    @ReactMethod
    fun syncSpamNumbers(items: ReadableArray, promise: Promise) {
        Log.d(TRACE_TAG, "syncSpamNumbers() size=${items.size()}")
        emitCallDebug("CALL_BLOCKER_MODULE syncSpamNumbers size=${items.size()}")
        try {
            val db = openDb() ?: run {
                promise.reject("DB_NOT_FOUND", "Database not found")
                return
            }

            db.beginTransaction()
            try {
                for (i in 0 until items.size()) {
                    val m = items.getMap(i) ?: continue
                    val phone = PhoneUtils.normalize(m.getString("phone"))
                    if (phone.isEmpty()) continue

                    val risk = if (m.hasKey("risk_level") && !m.isNull("risk_level")) m.getInt("risk_level") else 0
                    val del = if (m.hasKey("server_deleted") && !m.isNull("server_deleted")) m.getInt("server_deleted") else 0
                    val updatedAt = if (m.hasKey("updated_at") && !m.isNull("updated_at")) m.getString("updated_at") else null

                    db.execSQL(
                        """
                        INSERT OR IGNORE INTO scam_phones (phone_normalized, server_updated_at)
                        VALUES (?, COALESCE(?, datetime('now')))
                        """.trimIndent(),
                        arrayOf<Any?>(phone, updatedAt)
                    )

                    db.execSQL(
                        """
                        UPDATE scam_phones
                        SET risk_level = ?, server_deleted = ?, server_updated_at = COALESCE(?, server_updated_at)
                        WHERE phone_normalized = ?
                        """.trimIndent(),
                        arrayOf<Any?>(risk, del, updatedAt, phone)
                    )
                }

                db.setTransactionSuccessful()
                promise.resolve(true)
            } finally {
                db.endTransaction()
                db.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[syncSpamNumbers] ERROR", e)
            promise.reject("SYNC_SPAM_ERROR", e)
        }
    }

    // ========================
    // Spec-required: getIncomingCallEvents
    // Reads local blocked_logs (call/sms) as the offline event source.
    // ========================
    @ReactMethod
    fun getIncomingCallEvents(sinceId: Int, limit: Int, promise: Promise) {
        Log.d(TRACE_TAG, "getIncomingCallEvents() sinceId=$sinceId limit=$limit")
        emitCallDebug(
            source = "CALL_BLOCKER_MODULE",
            msg = "incoming events ENTER sinceId=$sinceId limit=$limit",
            action = "GET_INCOMING_CALL_EVENTS_ENTER",
        )
        try {
            val db = openDb() ?: run {
                promise.reject("DB_NOT_FOUND", "Database not found")
                return
            }

            val safeLimit = Math.max(1, Math.min(limit, 500))
            val arr = WritableNativeArray()

            val cursor = db.rawQuery(
                """
                SELECT id, phone_normalized, raw_phone, type, created_at, detail
                FROM blocked_logs
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
                """.trimIndent(),
                arrayOf(Math.max(0, sinceId).toString(), safeLimit.toString())
            )

            cursor.use { c ->
                while (c.moveToNext()) {
                    val m = Arguments.createMap()
                    m.putInt("id", c.getInt(c.getColumnIndexOrThrow("id")))
                    m.putString("phone_normalized", c.getString(c.getColumnIndexOrThrow("phone_normalized")))
                    m.putString("raw_phone", c.getString(c.getColumnIndexOrThrow("raw_phone")))
                    m.putString("type", c.getString(c.getColumnIndexOrThrow("type")))
                    m.putString("created_at", c.getString(c.getColumnIndexOrThrow("created_at")))
                    m.putString("detail", c.getString(c.getColumnIndexOrThrow("detail")))
                    arr.pushMap(m)
                }
            }

            db.close()
            emitCallDebug(
                source = "CALL_BLOCKER_MODULE",
                msg = "incoming events RESULT count=${arr.size()}",
                action = "GET_INCOMING_CALL_EVENTS_RESULT",
            )
            promise.resolve(arr)
        } catch (e: Exception) {
            Log.e(TAG, "[getIncomingCallEvents] ERROR", e)
            emitCallDebug(
                source = "CALL_BLOCKER_MODULE",
                msg = "incoming events ERROR: ${e.message}",
                action = "GET_INCOMING_CALL_EVENTS_ERROR",
            )
            promise.reject("GET_EVENTS_ERROR", e)
        }
    }

    // ========================
    // Test-mode helper: synthetic incoming-call debug flow
    // ========================
    @ReactMethod
    fun debugSimulateIncomingCall(rawNumber: String, promise: Promise) {
        emitCallDebug(
            source = "CALL_BLOCKER_MODULE",
            msg = "SYNTHETIC INCOMING_CALL ENTER",
            rawNumber = rawNumber,
            action = "SYNTHETIC_INCOMING_CALL_ENTER",
        )

        try {
            val normalized = PhoneUtils.normalize(rawNumber)
            emitCallDebug(
                source = "CALL_BLOCKER_MODULE",
                msg = "SYNTHETIC normalize",
                rawNumber = rawNumber,
                normalizedNumber = normalized,
                action = "SYNTHETIC_NORMALIZE",
            )

            if (normalized.isEmpty()) {
                emitCallDebug(
                    source = "CALL_BLOCKER_MODULE",
                    msg = "SYNTHETIC no number -> allow",
                    rawNumber = rawNumber,
                    normalizedNumber = normalized,
                    action = "ALLOW",
                )
                val out = Arguments.createMap()
                out.putString("rawNumber", rawNumber)
                out.putString("normalizedNumber", normalized)
                out.putBoolean("matchedBlocked", false)
                out.putBoolean("matchedSpam", false)
                out.putString("action", "ALLOW")
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                promise.reject("DB_NOT_FOUND", "Database not found")
                return
            }

            val variants = PhoneUtils.variants(normalized)
            val placeholders = variants.joinToString(",") { "?" }
            val cursor = db.rawQuery(
                """
                SELECT risk_level, server_deleted, local_blocked
                FROM scam_phones
                WHERE phone_normalized IN ($placeholders)
                ORDER BY local_blocked DESC, risk_level DESC
                LIMIT 1
                """.trimIndent(),
                variants
            )

            var matchedBlocked = false
            var matchedSpam = false
            var risk = 0

            cursor.use { c ->
                if (c.moveToFirst()) {
                    risk = c.getInt(c.getColumnIndexOrThrow("risk_level"))
                    val deleted = c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                    val local = c.getInt(c.getColumnIndexOrThrow("local_blocked"))
                    matchedBlocked = local == 1
                    // Keep logic aligned with CallBlockerService: community spam if not locally blocked.
                    matchedSpam = !matchedBlocked && deleted == 0 && risk >= 60
                }
            }

            db.close()

            emitCallDebug(
                source = "CALL_BLOCKER_MODULE",
                msg = "SYNTHETIC match",
                rawNumber = rawNumber,
                normalizedNumber = normalized,
                matchedBlocked = matchedBlocked,
                matchedSpam = matchedSpam,
                action = "SYNTHETIC_MATCH",
            )

            val out = Arguments.createMap()
            out.putString("rawNumber", rawNumber)
            out.putString("normalizedNumber", normalized)
            out.putBoolean("matchedBlocked", matchedBlocked)
            out.putBoolean("matchedSpam", matchedSpam)
            out.putInt("risk", risk)
            out.putString("action", "SYNTHETIC")
            promise.resolve(out)
        } catch (e: Exception) {
            emitCallDebug(
                source = "CALL_BLOCKER_MODULE",
                msg = "SYNTHETIC ERROR: ${e.message}",
                rawNumber = rawNumber,
                action = "SYNTHETIC_ERROR",
            )
            promise.reject("SYNTHETIC_INCOMING_CALL_ERROR", e)
        }
    }
}
