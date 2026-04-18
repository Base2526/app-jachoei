package com.jachoei

import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import com.facebook.react.bridge.*
import android.util.Log
import android.content.Context
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.util.ArrayDeque
import org.json.JSONArray
import org.json.JSONObject

class CallBlockerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "JACHOEI_CALL"
        private const val TRACE_TAG = "CALL_BLOCKER_MODULE"
        private const val DB_NAME = "scam-protect.db"

        private const val DIAG_PREFS = "jachoei_hidden_diagnostics"
        private const val DIAG_KEY = "jachoei.hidden_debug_mode.v1"

        @Volatile private var hiddenDiagnosticsEnabled: Boolean = false

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

        // Last write diagnostics (helps debug device-only persistence issues)
        @Volatile private var lastWriteTs: Long = 0
        @Volatile private var lastWriteAction: String? = null
        @Volatile private var lastWriteRowsAffected: Int? = null
        @Volatile private var lastWriteError: String? = null
        @Volatile private var lastWriteDbPath: String? = null

        // Deep write diagnostics (debug)
        @Volatile private var lastWriteDbName: String? = null
        @Volatile private var lastWriteTable: String? = null
        @Volatile private var lastWriteSql: String? = null
        @Volatile private var lastWriteArgs: String? = null
        @Volatile private var lastWriteCommitted: Boolean = false
        @Volatile private var lastWriteInsertRowId: Long = 0
        @Volatile private var lastWriteUpdateChanges: Int = 0
        @Volatile private var lastWriteCountAfter: Int = 0
        @Volatile private var lastWriteSample: String? = null

        @Volatile private var lastWritePhoneNormalized: String? = null
        @Volatile private var lastWriteDidInsert: Boolean = false
        @Volatile private var lastWriteDidUpdate: Boolean = false
        @Volatile private var lastWriteMatchedRow: String? = null

        // Last blocked phone lookup context (debug export)
        @Volatile private var lastBlockedInputRaw: String? = null
        @Volatile private var lastBlockedCanonical: String? = null
        @Volatile private var lastBlockedVariants: List<String>? = null
        @Volatile private var lastBlockedMatchingRowsByVariantJson: String? = null
        @Volatile private var lastBlockedFinalDecision: String? = null
        @Volatile private var lastBlockedMatchedVariant: String? = null
        @Volatile private var lastBlockedMatchedRowJson: String? = null

        private fun toJsonValue(value: Any?): Any {
            return when (value) {
                null -> JSONObject.NULL
                is String -> value
                is Boolean -> value
                is Int -> value
                is Long -> value
                is Double -> value
                is Float -> value.toDouble()
                is Number -> value.toDouble()
                else -> value.toString()
            }
        }

        private fun rowsByVariantToJson(rowsByVariant: Map<String, List<Map<String, Any?>>>): String {
            val root = JSONObject()
            for ((variant, rows) in rowsByVariant) {
                val arr = JSONArray()
                for (row in rows) {
                    val obj = JSONObject()
                    for ((key, value) in row) {
                        obj.put(key, toJsonValue(value))
                    }
                    arr.put(obj)
                }
                root.put(variant, arr)
            }
            return root.toString()
        }

        private fun rowToJson(row: Map<String, Any?>?): String? {
            if (row == null) return null
            val obj = JSONObject()
            for ((key, value) in row) {
                obj.put(key, toJsonValue(value))
            }
            return obj.toString()
        }

        @Synchronized
        fun recordLastBlockedPhoneLookup(
            originalInput: String?,
            canonical: String?,
            variants: List<String>?,
            matchingRowsByVariant: Map<String, List<Map<String, Any?>>>,
            finalDecision: String,
            matchedVariant: String?,
            matchedRow: Map<String, Any?>?,
        ) {
            lastBlockedInputRaw = originalInput?.trim().orEmpty()
            lastBlockedCanonical = canonical?.trim().orEmpty()
            lastBlockedVariants = variants?.toList() ?: emptyList()
            lastBlockedMatchingRowsByVariantJson = rowsByVariantToJson(matchingRowsByVariant)
            lastBlockedFinalDecision = finalDecision
            lastBlockedMatchedVariant = matchedVariant?.trim().orEmpty()
            lastBlockedMatchedRowJson = rowToJson(matchedRow)
        }

        @Synchronized
        private fun recordLastWrite(
            action: String,
            dbPath: String?,
            rows: Int? = null,
            error: String? = null,
            committed: Boolean? = null,
        ) {
            lastWriteTs = System.currentTimeMillis()
            lastWriteAction = action
            lastWriteDbPath = dbPath
            lastWriteRowsAffected = rows
            lastWriteError = error
            if (committed != null) {
                lastWriteCommitted = committed
            }
        }

        @Synchronized
        private fun recordLastWriteDeep(
            action: String,
            dbName: String,
            dbPath: String?,
            table: String,
            sql: String,
            args: String,
            committed: Boolean,
            insertRowId: Long,
            updateChanges: Int,
            countAfter: Int,
            sampleJson: String?,
            phoneNormalized: String?,
            didInsert: Boolean,
            didUpdate: Boolean,
            matchedRowJson: String?,
            error: String?,
        ) {
            recordLastWrite(action, dbPath, updateChanges, error, committed)
            lastWriteDbName = dbName
            lastWriteTable = table
            lastWriteSql = sql
            lastWriteArgs = args
            lastWriteCommitted = committed
            lastWriteInsertRowId = insertRowId
            lastWriteUpdateChanges = updateChanges
            lastWriteCountAfter = countAfter
            lastWriteSample = sampleJson

            lastWritePhoneNormalized = phoneNormalized
            lastWriteDidInsert = didInsert
            lastWriteDidUpdate = didUpdate
            lastWriteMatchedRow = matchedRowJson
        }

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

    private fun diagnosticsEnabled(): Boolean {
        if (BuildConfig.DEBUG) return true
        if (hiddenDiagnosticsEnabled) return true
        return try {
            val v = reactContext
                .applicationContext
                .getSharedPreferences(DIAG_PREFS, Context.MODE_PRIVATE)
                .getBoolean(DIAG_KEY, false)
            hiddenDiagnosticsEnabled = v
            v
        } catch (_: Exception) {
            false
        }
    }

    @ReactMethod
    fun setHiddenDiagnosticsEnabled(enabled: Boolean, promise: Promise) {
        try {
            hiddenDiagnosticsEnabled = enabled
            reactContext
                .applicationContext
                .getSharedPreferences(DIAG_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(DIAG_KEY, enabled)
                .apply()
            promise.resolve(true)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isHiddenDiagnosticsEnabled(promise: Promise) {
        promise.resolve(diagnosticsEnabled())
    }

    private fun getDbFile(): File {
        val f = reactContext.getDatabasePath(DB_NAME)
        try {
            f.parentFile?.mkdirs()
        } catch (_: Exception) {
            // ignore
        }
        return f
    }

    private fun logDbDiag(prefix: String, extra: String? = null) {
        if (!BuildConfig.DEBUG) return
        val dbFile = try { getDbFile() } catch (e: Exception) {
            Log.d(TRACE_TAG, "$prefix dbFile ERROR=${e.message}")
            return
        }

        val msg = buildString {
            append(prefix)
            append(" pkg=")
            append(reactContext.packageName)
            append(" path=")
            append(dbFile.absolutePath)
            append(" exists=")
            append(dbFile.exists())
            append(" size=")
            append(dbFile.length())
            if (!extra.isNullOrBlank()) {
                append(" ")
                append(extra)
            }
        }

        Log.d(TRACE_TAG, msg)
        emitCallDebug(
            source = "DB_LOOKUP",
            msg = msg,
            dbName = DB_NAME,
            dbPath = dbFile.absolutePath,
            table = "scam_phones",
            action = "DB_DIAG",
        )
    }

    private fun ensureCanonicalBlockedRow(db: SQLiteDatabase, rawPhone: String): PhoneUtils.PhoneMatchContext {
        val ctx = PhoneUtils.buildMatchContext(rawPhone)
        if (ctx.canonical.isBlank()) return ctx

        db.execSQL(
            """
            INSERT OR IGNORE INTO scam_phones (phone_normalized, server_updated_at)
            VALUES (?, datetime('now'))
            """.trimIndent(),
            arrayOf(ctx.canonical)
        )

        db.execSQL(
            """
            UPDATE scam_phones
            SET local_blocked = 1,
                server_deleted = 0,
                server_updated_at = datetime('now')
            WHERE phone_normalized = ?
            """.trimIndent(),
            arrayOf(ctx.canonical)
        )

        val cleanupTargets = ctx.variants.filter { it != ctx.canonical }
        if (cleanupTargets.isNotEmpty()) {
            val placeholders = cleanupTargets.joinToString(",") { "?" }
            db.execSQL(
                """
                UPDATE scam_phones
                SET local_blocked = 0,
                    server_updated_at = datetime('now')
                WHERE local_blocked = 1
                  AND phone_normalized IN ($placeholders)
                """.trimIndent(),
                cleanupTargets.toTypedArray()
            )
        }

        return ctx
    }

    private fun cleanupInconsistentLocalBlockedRows(db: SQLiteDatabase): Int {
        val storedPhones = ArrayList<String>()
        db.rawQuery(
            """
            SELECT phone_normalized
            FROM scam_phones
            WHERE local_blocked = 1
            ORDER BY phone_normalized ASC
            """.trimIndent(),
            emptyArray()
        ).use { c ->
            while (c.moveToNext()) {
                val phone = c.getString(c.getColumnIndexOrThrow("phone_normalized"))
                if (!phone.isNullOrBlank()) storedPhones.add(phone)
            }
        }

        var touched = 0
        val processedCanonicals = LinkedHashSet<String>()
        for (stored in storedPhones) {
            val ctx = PhoneUtils.buildMatchContext(stored)
            if (ctx.canonical.isBlank()) {
                val stmt = db.compileStatement(
                    "UPDATE scam_phones SET local_blocked = 0, server_updated_at = datetime('now') WHERE phone_normalized = ?"
                )
                stmt.bindString(1, stored)
                touched += try { stmt.executeUpdateDelete() } catch (_: Exception) { 0 }
                continue
            }
            if (!processedCanonicals.add(ctx.canonical)) continue
            ensureCanonicalBlockedRow(db, stored)
            touched += 1
        }
        return touched
    }

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
            val dbFile = getDbFile()
            logDbDiag("openDb ENTER", "(openDatabase READWRITE|CREATE)")

            DiagnosticsStore.record(
                context = reactContext,
                topic = "DB",
                msg = "openDb ENTER",
                data = mapOf(
                    "db" to DB_NAME,
                    "path" to dbFile.absolutePath,
                    "exists" to dbFile.exists(),
                    "size" to dbFile.length(),
                ),
            )

            val db = SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
            )
            ensureScamPhonesTable(db)
            ensureBlockedLogsTable(db)
            CallCheckLogUtils.ensureTable(db)

            if (BuildConfig.DEBUG) {
                try {
                    val cur = db.rawQuery("PRAGMA database_list", null)
                    cur.use { c ->
                        val nameIdx = c.getColumnIndex("name")
                        val fileIdx = c.getColumnIndex("file")
                        while (c.moveToNext()) {
                            val n = if (nameIdx >= 0 && !c.isNull(nameIdx)) c.getString(nameIdx) else "?"
                            val f = if (fileIdx >= 0 && !c.isNull(fileIdx)) c.getString(fileIdx) else ""
                            Log.d(TRACE_TAG, "[PRAGMA database_list] $n -> $f")
                        }
                    }
                } catch (_: Exception) {
                    // ignore
                }
            }

            logDbDiag("openDb OK")
            DiagnosticsStore.record(
                context = reactContext,
                topic = "DB",
                msg = "openDb OK",
                data = mapOf(
                    "db" to DB_NAME,
                    "path" to dbFile.absolutePath,
                    "exists" to dbFile.exists(),
                    "size" to dbFile.length(),
                ),
            )
            db
        } catch (e: Exception) {
            Log.e(TAG, "[openDb] error", e)
            Log.d(TRACE_TAG, "openDb() ERROR: ${e.message}")
            DiagnosticsStore.record(
                context = reactContext,
                topic = "DB",
                msg = "openDb ERROR: ${e.message}",
                data = mapOf("db" to DB_NAME),
            )
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

        val writeTable = "scam_phones"
        val updateSql = "UPDATE scam_phones SET local_blocked = 1, server_deleted = 0, server_updated_at = datetime('now') WHERE phone_normalized = ?"
        val insertSql = "INSERT OR IGNORE INTO scam_phones (phone_normalized, server_updated_at) VALUES (?, datetime('now'))"
        var committed = false
        var insertRowId: Long = 0
        var rowsUpdated = 0
        var countAfter = 0
        var sampleAfter: String? = null
        var matchedRowAfter: String? = null
        var didInsert = false
        var didUpdate = false

        try {
            logDbDiag("addBlockedNumber ENTER", "raw=$phoneRaw")
            DiagnosticsStore.record(
                context = reactContext,
                topic = "DB_WRITE",
                msg = "addBlockedNumber ENTER",
                data = mapOf("raw" to phoneRaw),
            )
            val dbPath = try { getDbFile().absolutePath } catch (_: Exception) { null }
            val phoneContext = PhoneUtils.buildMatchContext(phoneRaw)
            val phone = phoneContext.canonical
            if (phone.isBlank()) {
                val msg = "empty normalized phone"
                recordLastWriteDeep(
                    action = "addBlockedNumber",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = writeTable,
                    sql = updateSql,
                    args = "raw=$phoneRaw",
                    committed = false,
                    insertRowId = 0,
                    updateChanges = 0,
                    countAfter = 0,
                    sampleJson = null,
                    phoneNormalized = phone,
                    didInsert = false,
                    didUpdate = false,
                    matchedRowJson = null,
                    error = msg,
                )
                promise.reject("ADD_BLOCK_ERROR", msg)
                return
            }
            val variants = phoneContext.variants

            // Save last lookup context for export.
            lastBlockedInputRaw = phoneRaw
            lastBlockedCanonical = phone
            lastBlockedVariants = variants.toList()
            Log.d(TAG, "[normalize] phone = '$phone' variants=${variants.size}")

            val db = openDb()
            if (db == null) {
                val msg = "Database not found"
                Log.e(TAG, "[addBlockedNumber] $msg")
                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "DB_WRITE",
                    msg = "addBlockedNumber DB_NOT_FOUND",
                    data = mapOf("raw" to phoneRaw),
                )
                promise.reject("DB_NOT_FOUND", msg)
                return
            }

            db.beginTransaction()
            try {
                val ins = db.compileStatement(insertSql)
                ins.bindString(1, phone)
                insertRowId = try { ins.executeInsert() } catch (_: Exception) { -1L }
                didInsert = insertRowId > 0

                val upd = db.compileStatement(updateSql)
                upd.bindString(1, phone)
                rowsUpdated = try { upd.executeUpdateDelete() } catch (_: Exception) { 0 }
                didUpdate = rowsUpdated > 0

                ensureCanonicalBlockedRow(db, phoneRaw)

                if (BuildConfig.DEBUG) {
                    emitCallDebug(
                        source = "DB_WRITE",
                        msg = "addBlockedNumber upsert OK updated=$rowsUpdated insertRowId=$insertRowId",
                        dbName = DB_NAME,
                        dbPath = dbPath,
                        table = writeTable,
                        action = "DB_WRITE_UPSERT",
                        normalizedNumber = phone,
                        rowsFound = rowsUpdated,
                    )
                }

                db.setTransactionSuccessful()
                committed = true
                Log.d(TAG, "[SUCCESS] '$phone' is now BLOCKED")

                // post-write proof (same connection)
                try {
                    val c = db.rawQuery("SELECT COUNT(*) AS c FROM $writeTable", null)
                    c.use { cur -> if (cur.moveToFirst() && !cur.isNull(0)) countAfter = cur.getInt(0) }
                } catch (_: Exception) {
                    countAfter = 0
                }

                matchedRowAfter = try {
                    val cur = db.rawQuery(
                        "SELECT id, phone_normalized, local_blocked, risk_level, report_count, server_deleted, server_updated_at FROM $writeTable WHERE phone_normalized = ? LIMIT 1",
                        arrayOf(phone)
                    )
                    val rows = ArrayList<Map<String, Any?>>()
                    cur.use { c ->
                        while (c.moveToNext()) {
                            val m = LinkedHashMap<String, Any?>()
                            m["id"] = if (!c.isNull(0)) c.getInt(0) else null
                            m["phone_normalized"] = if (!c.isNull(1)) c.getString(1) else null
                            m["local_blocked"] = if (!c.isNull(2)) c.getInt(2) else null
                            m["risk_level"] = if (!c.isNull(3)) c.getInt(3) else null
                            m["report_count"] = if (!c.isNull(4)) c.getInt(4) else null
                            m["server_deleted"] = if (!c.isNull(5)) c.getInt(5) else null
                            m["server_updated_at"] = if (!c.isNull(6)) c.getString(6) else null
                            rows.add(m)
                        }
                    }
                    org.json.JSONArray(rows).toString()
                } catch (_: Exception) {
                    null
                }

                sampleAfter = try {
                    val cur = db.rawQuery(
                        "SELECT id, phone_normalized, local_blocked, risk_level, report_count, server_deleted, server_updated_at FROM $writeTable ORDER BY id DESC LIMIT 5",
                        null
                    )
                    val rows = ArrayList<Map<String, Any?>>()
                    cur.use { c ->
                        while (c.moveToNext()) {
                            val m = LinkedHashMap<String, Any?>()
                            m["id"] = if (!c.isNull(0)) c.getInt(0) else null
                            m["phone_normalized"] = if (!c.isNull(1)) c.getString(1) else null
                            m["local_blocked"] = if (!c.isNull(2)) c.getInt(2) else null
                            m["risk_level"] = if (!c.isNull(3)) c.getInt(3) else null
                            m["report_count"] = if (!c.isNull(4)) c.getInt(4) else null
                            m["server_deleted"] = if (!c.isNull(5)) c.getInt(5) else null
                            m["server_updated_at"] = if (!c.isNull(6)) c.getString(6) else null
                            rows.add(m)
                        }
                    }
                    org.json.JSONArray(rows).toString()
                } catch (_: Exception) {
                    null
                }

                // Notify only when we actually set local_blocked.
                if (rowsUpdated > 0) {
                    JachoeiNotificationUtils.showLocalBlockNotification(phone)
                    emitCallDebug(
                        source = "BLOCK_ACTION",
                        msg = "local block success -> notification shown",
                        normalizedNumber = phone,
                        action = "LOCAL_BLOCK_NOTIFY",
                    )
                }

                promise.resolve(true)

                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "DB_WRITE",
                    msg = "addBlockedNumber OK",
                    data = mapOf(
                        "phone" to phone,
                        "rowsUpdated" to rowsUpdated,
                        "insertRowId" to insertRowId,
                        "committed" to committed,
                        "countAfter" to countAfter,
                    ),
                )

                recordLastWriteDeep(
                    action = "addBlockedNumber",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = writeTable,
                    sql = "${updateSql} ; ${insertSql}",
                    args = "phone=$phone variants=${variants.size}",
                    committed = committed,
                    insertRowId = insertRowId,
                    updateChanges = rowsUpdated,
                    countAfter = countAfter,
                    sampleJson = sampleAfter,
                    phoneNormalized = phone,
                    didInsert = didInsert,
                    didUpdate = didUpdate,
                    matchedRowJson = matchedRowAfter,
                    error = null,
                )

                if (BuildConfig.DEBUG) {
                    try {
                        val cur = db.rawQuery(
                            "SELECT COUNT(*) AS c, SUM(CASE WHEN local_blocked=1 THEN 1 ELSE 0 END) AS lc FROM scam_phones",
                            null
                        )
                        cur.use { c ->
                            if (c.moveToFirst()) {
                                val cAll = if (!c.isNull(0)) c.getInt(0) else 0
                                val cLocal = if (!c.isNull(1)) c.getInt(1) else 0
                                logDbDiag("addBlockedNumber AFTER_WRITE", "count=$cAll local=$cLocal updated=$rowsUpdated insertRowId=$insertRowId committed=$committed")
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }

            } finally {
                db.endTransaction()
                db.close()
            }

        } catch (e: Exception) {
            Log.e(TAG, "[addBlockedNumber] ERROR", e)
            DiagnosticsStore.record(
                context = reactContext,
                topic = "DB_WRITE",
                msg = "addBlockedNumber ERROR: ${e.message}",
                data = mapOf("raw" to phoneRaw),
            )
            recordLastWriteDeep(
                action = "addBlockedNumber",
                dbName = DB_NAME,
                dbPath = try { getDbFile().absolutePath } catch (_: Exception) { null },
                table = writeTable,
                sql = "${updateSql} ; ${insertSql}",
                args = "raw=$phoneRaw",
                committed = committed,
                insertRowId = insertRowId,
                updateChanges = rowsUpdated,
                countAfter = countAfter,
                sampleJson = sampleAfter,
                phoneNormalized = null,
                didInsert = didInsert,
                didUpdate = didUpdate,
                matchedRowJson = matchedRowAfter,
                error = e.message ?: "unknown",
            )
            promise.reject("ADD_BLOCK_ERROR", e)
        }
    }

    // ========================
    // Release-safe diagnostics bridge
    // ========================
    @ReactMethod
    fun recordReleaseDiagnostic(topic: String, msg: String, data: ReadableMap?, promise: Promise) {
        try {
            val m = LinkedHashMap<String, Any?>()
            if (data != null) {
                val it = data.keySetIterator()
                while (it.hasNextKey()) {
                    val k = it.nextKey()
                    when (data.getType(k)) {
                        ReadableType.Null -> m[k] = null
                        ReadableType.Boolean -> m[k] = data.getBoolean(k)
                        ReadableType.Number -> m[k] = data.getDouble(k)
                        ReadableType.String -> m[k] = data.getString(k)
                        else -> m[k] = "(unsupported)"
                    }
                }
            }
            DiagnosticsStore.record(
                context = reactContext,
                topic = topic,
                msg = msg,
                data = m,
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getReleaseDiagnostics(promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.reject("DIAG_DISABLED", "getReleaseDiagnostics requires hidden diagnostics mode")
            return
        }
        try {
            val arr = DiagnosticsStore.read(reactContext)
            val out = Arguments.createMap()

            val events = Arguments.createArray()
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val m = Arguments.createMap()
                m.putDouble("ts", (obj.optLong("ts", 0L)).toDouble())
                m.putString("topic", obj.optString("topic", ""))
                m.putString("msg", obj.optString("msg", ""))
                val d = obj.optJSONObject("data")
                if (d != null) {
                    val dm = Arguments.createMap()
                    val keys = d.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = d.opt(k)
                        when (v) {
                            null, org.json.JSONObject.NULL -> dm.putNull(k)
                            is Boolean -> dm.putBoolean(k, v)
                            is Int -> dm.putInt(k, v)
                            is Long -> dm.putDouble(k, v.toDouble())
                            is Double -> dm.putDouble(k, v)
                            is Float -> dm.putDouble(k, v.toDouble())
                            else -> dm.putString(k, v.toString())
                        }
                    }
                    m.putMap("data", dm)
                }
                events.pushMap(m)
            }

            // Include a tiny DB snapshot to quickly see whether schema/data exists.
            val dbFile = getDbFile()
            out.putString("dbPath", dbFile.absolutePath)
            out.putBoolean("dbExists", dbFile.exists())
            out.putDouble("dbSizeBytes", dbFile.length().toDouble())
            out.putArray("events", events)

            // Best-effort counts.
            var scamCount = 0
            var localCount = 0
            try {
                val db = SQLiteDatabase.openDatabase(
                    dbFile.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY
                )
                db.rawQuery("SELECT COUNT(*) AS c FROM scam_phones", null).use { c ->
                    if (c.moveToFirst() && !c.isNull(0)) scamCount = c.getInt(0)
                }
                db.rawQuery("SELECT COUNT(*) AS c FROM scam_phones WHERE local_blocked = 1", null).use { c ->
                    if (c.moveToFirst() && !c.isNull(0)) localCount = c.getInt(0)
                }
                db.close()
            } catch (_: Exception) {
                // ignore
            }
            out.putInt("scamPhonesCount", scamCount)
            out.putInt("localBlockedCount", localCount)

            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("DIAG_ERROR", e)
        }
    }

    @ReactMethod
    fun clearReleaseDiagnostics(promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.resolve(false)
            return
        }
        try {
            DiagnosticsStore.clear(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getCallCheckLogs(limit: Int, promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.reject("DIAG_DISABLED", "getCallCheckLogs requires hidden diagnostics mode")
            return
        }

        try {
            val rows = CallCheckLogUtils.listLogs(reactContext, limit)
            val arr = Arguments.createArray()
            for (row in rows) {
                val m = Arguments.createMap()
                m.putDouble("id", row.id.toDouble())
                m.putString("phone_original", row.phoneOriginal)
                m.putString("phone_normalized", row.phoneNormalized)
                m.putDouble("timestamp", row.timestampMs.toDouble())
                m.putDouble("db_lookup_started_at", row.dbLookupStartedAtMs.toDouble())
                m.putDouble("db_lookup_finished_at", row.dbLookupFinishedAtMs.toDouble())
                m.putString("table_queried", row.tableQueried)
                m.putBoolean("match_found", row.matchFound)
                m.putInt("local_blocked", row.localBlocked)
                m.putInt("global_risk_level", row.globalRiskLevel)
                m.putInt("global_report_count", row.globalReportCount)
                m.putString("matched_source", row.matchedSource)
                m.putString("final_action", row.finalAction)
                m.putString("reason", row.reason)
                m.putString("decision_explanation", row.decisionExplanation)
                m.putString("normalization_variants_checked", row.normalizationVariantsChecked)
                m.putDouble("lookup_duration_ms", row.lookupDurationMs)
                m.putString("device_state", row.deviceState)
                m.putString("service_state", row.serviceState)
                m.putString("created_at", row.createdAt)
                arr.pushMap(m)
            }
            promise.resolve(arr)
        } catch (e: Exception) {
            promise.reject("CALL_CHECK_LOGS_ERROR", e)
        }
    }

    @ReactMethod
    fun clearCallCheckLogs(promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.resolve(false)
            return
        }
        try {
            val deleted = CallCheckLogUtils.clearLogs(reactContext)
            val out = Arguments.createMap()
            out.putBoolean("ok", true)
            out.putInt("deleted", deleted)
            promise.resolve(out)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun copyDatabaseForExport(promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.reject("DIAG_DISABLED", "copyDatabaseForExport requires hidden diagnostics mode")
            return
        }

        try {
            val src = getDbFile()
            if (!src.exists()) {
                promise.reject("DB_NOT_FOUND", "database file not found")
                return
            }

            val dir = File(reactContext.cacheDir, "exports")
            if (!dir.exists()) dir.mkdirs()
            val dst = File(dir, "scam-protect-export-${System.currentTimeMillis()}.db")

            FileInputStream(src).channel.use { inChannel ->
                FileOutputStream(dst).channel.use { outChannel ->
                    outChannel.transferFrom(inChannel, 0, inChannel.size())
                }
            }

            val out = Arguments.createMap()
            out.putBoolean("ok", true)
            out.putString("sourcePath", src.absolutePath)
            out.putString("exportPath", dst.absolutePath)
            out.putDouble("sizeBytes", dst.length().toDouble())
            out.putDouble("exportedAt", System.currentTimeMillis().toDouble())
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("COPY_DB_ERROR", e)
        }
    }

    @ReactMethod
    fun runDbHealthCheck(promise: Promise) {
        if (!diagnosticsEnabled()) {
            promise.reject("DIAG_DISABLED", "runDbHealthCheck requires hidden diagnostics mode")
            return
        }

        try {
            val db = openDb() ?: run {
                promise.reject("DB_NOT_FOUND", "Database not found")
                return
            }

            val requiredTables = listOf("scam_phones", "blocked_logs", "call_check_logs")
            val requiredScamPhoneColumns = listOf(
                "phone_normalized",
                "risk_level",
                "local_blocked",
                "server_deleted",
                "report_count",
                "server_updated_at"
            )

            val tableExists = Arguments.createMap()
            val tableCounts = Arguments.createMap()
            val schemaIssues = Arguments.createArray()

            val tableNames = ArrayList<String>()
            db.rawQuery(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                null
            ).use { c ->
                val idx = c.getColumnIndex("name")
                while (c.moveToNext()) {
                    if (idx >= 0 && !c.isNull(idx)) tableNames.add(c.getString(idx))
                }
            }

            for (t in requiredTables) {
                val exists = tableNames.contains(t)
                tableExists.putBoolean(t, exists)
                if (!exists) {
                    schemaIssues.pushString("Missing table: $t")
                    continue
                }

                try {
                    db.rawQuery("SELECT COUNT(*) AS c FROM $t", null).use { c ->
                        val n = if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
                        tableCounts.putInt(t, n)
                    }
                } catch (_: Exception) {
                    tableCounts.putInt(t, -1)
                }
            }

            val scamPhoneCols = LinkedHashSet<String>()
            db.rawQuery("PRAGMA table_info(scam_phones)", null).use { c ->
                val idx = c.getColumnIndex("name")
                while (c.moveToNext()) {
                    if (idx >= 0 && !c.isNull(idx)) scamPhoneCols.add(c.getString(idx))
                }
            }
            for (col in requiredScamPhoneColumns) {
                if (!scamPhoneCols.contains(col)) {
                    schemaIssues.pushString("Missing scam_phones column: $col")
                }
            }

            val syncState = Arguments.createMap()
            try {
                db.rawQuery(
                    "SELECT last_full_sync_at, last_delta_sync_at, last_version, local_rows FROM sync_state WHERE id = 1",
                    null
                ).use { c ->
                    if (c.moveToFirst()) {
                        syncState.putString("last_full_sync_at", if (!c.isNull(0)) c.getString(0) else "")
                        syncState.putString("last_delta_sync_at", if (!c.isNull(1)) c.getString(1) else "")
                        syncState.putString("last_version", if (!c.isNull(2)) c.getString(2) else "")
                        syncState.putInt("local_rows", if (!c.isNull(3)) c.getInt(3) else 0)
                    }
                }
            } catch (_: Exception) {
                // optional table
            }

            db.close()

            val issuesCount = schemaIssues.size()
            val healthStatus = if (issuesCount == 0) "healthy" else if (issuesCount <= 2) "warning" else "unhealthy"

            val out = Arguments.createMap()
            out.putString("db_health_status", healthStatus)
            out.putBoolean("schema_validation_result", issuesCount == 0)
            out.putArray("schema_issues", schemaIssues)
            out.putMap("table_exists", tableExists)
            out.putMap("table_counts", tableCounts)
            out.putMap("sync_state", syncState)
            out.putString("dbPath", getDbFile().absolutePath)
            out.putString("dbName", DB_NAME)
            out.putString("package_name", reactContext.packageName)
            out.putString("application_id", BuildConfig.APPLICATION_ID)
            out.putString("build_type", BuildConfig.BUILD_TYPE)
            out.putDouble("call_check_logs_count", CallCheckLogUtils.count(reactContext).toDouble())
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("DB_HEALTH_ERROR", e)
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
            logDbDiag("removeBlockedNumber ENTER", "raw=$phoneRaw")
            val dbPath = try { getDbFile().absolutePath } catch (_: Exception) { null }
            val phone = PhoneUtils.normalize(phoneRaw)
            val variants = PhoneUtils.variantsFromRaw(phoneRaw)
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
                Log.d(TAG, "[SQL] UPDATE local_blocked = -1")

                val placeholders = variants.joinToString(",") { "?" }
                val sql = "UPDATE scam_phones SET local_blocked = -1, server_updated_at = datetime('now') WHERE phone_normalized IN ($placeholders)"
                val stmt = db.compileStatement(sql)
                for ((i, v) in variants.withIndex()) stmt.bindString(i + 1, v)
                val updated = try { stmt.executeUpdateDelete() } catch (_: Exception) { 0 }

                db.setTransactionSuccessful()
                Log.d(TAG, "[SUCCESS] '$phone' is now UNBLOCKED")
                recordLastWrite("removeBlockedNumber", dbPath, updated, null, committed = true)
                promise.resolve(true)

                if (BuildConfig.DEBUG) {
                    try {
                        val cur = db.rawQuery(
                            "SELECT COUNT(*) AS c, SUM(CASE WHEN local_blocked=1 THEN 1 ELSE 0 END) AS lc FROM scam_phones",
                            null
                        )
                        cur.use { c ->
                            if (c.moveToFirst()) {
                                val cAll = if (!c.isNull(0)) c.getInt(0) else 0
                                val cLocal = if (!c.isNull(1)) c.getInt(1) else 0
                                logDbDiag("removeBlockedNumber AFTER_WRITE", "count=$cAll local=$cLocal")
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }

            } finally {
                db.endTransaction()
                db.close()
            }

        } catch (e: Exception) {
            Log.e(TAG, "[removeBlockedNumber] ERROR", e)
            recordLastWrite(
                "removeBlockedNumber",
                try { getDbFile().absolutePath } catch (_: Exception) { null },
                null,
                e.message ?: "unknown",
                committed = false
            )
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

            db.beginTransaction()
            try {
                cleanupInconsistentLocalBlockedRows(db)
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
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
    // DEBUG: Exact native lookup used by call screening
    // ========================
    @ReactMethod
    fun debugLookupNumber(phoneRaw: String, promise: Promise) {
        val out = Arguments.createMap()
        val dbFile = getDbFile()
        val dbPath = dbFile.absolutePath

        out.putString("dbName", DB_NAME)
        out.putString("dbPath", dbPath)
        out.putString("table", "scam_phones")
        out.putString("raw", phoneRaw)
        out.putString("digitsOnly", PhoneUtils.digitsOnly(phoneRaw))

        // Debug-only by default; allow in release when hidden diagnostics is enabled.
        if (!diagnosticsEnabled()) {
            out.putString("error", "diagnostics disabled")
            promise.resolve(out)
            return
        }

        val ctx = PhoneUtils.buildMatchContext(phoneRaw)
        val canonical = ctx.canonical
        val variantsArr = ctx.variants
        val variants = variantsArr.toList()
        out.putString("canonical", canonical)
        out.putArray("variants", Arguments.fromList(variants))
        out.putInt("rowsFound", 0)
        out.putString("decision", "ALLOW")
        out.putString("finalDecision", "ALLOW")
        out.putString("reason", "no_match")

        if (canonical.isBlank() || variants.isEmpty()) {
            out.putString("reason", "empty_input")
            promise.resolve(out)
            return
        }

        val t0 = SystemClock.elapsedRealtime()
        var db: SQLiteDatabase? = null
        try {
            db = openDb()
            if (db == null) {
                out.putString("error", "db open failed")
                out.putString("decision", "ALLOW")
                out.putString("reason", "db_open_failed")
                return
            }

            val lookup = ScamPhoneLookup.lookup(db, "scam_phones", phoneRaw, 60)
            out.putInt("rowsFound", lookup.rowsFound)
            out.putString("decision", lookup.finalDecision)
            out.putString("finalDecision", lookup.finalDecision)
            out.putString("reason", lookup.finalReason)
            if (!lookup.matchedVariant.isNullOrBlank()) out.putString("matchedVariant", lookup.matchedVariant)

            lookup.matchedRow?.let { rowMap ->
                val row = Arguments.createMap()
                for ((key, value) in rowMap) {
                    when (value) {
                        null -> row.putNull(key)
                        is String -> row.putString(key, value)
                        is Boolean -> row.putBoolean(key, value)
                        is Int -> row.putInt(key, value)
                        is Long -> row.putDouble(key, value.toDouble())
                        is Double -> row.putDouble(key, value)
                        else -> row.putString(key, value.toString())
                    }
                }
                out.putMap("matchedRow", row)
            }

            val matchingRows = Arguments.createMap()
            for ((variant, rows) in lookup.matchingRowsByVariant) {
                val arr = Arguments.createArray()
                for (rowMap in rows) {
                    val row = Arguments.createMap()
                    for ((key, value) in rowMap) {
                        when (value) {
                            null -> row.putNull(key)
                            is String -> row.putString(key, value)
                            is Boolean -> row.putBoolean(key, value)
                            is Int -> row.putInt(key, value)
                            is Long -> row.putDouble(key, value.toDouble())
                            is Double -> row.putDouble(key, value)
                            else -> row.putString(key, value.toString())
                        }
                    }
                    arr.pushMap(row)
                }
                matchingRows.putArray(variant, arr)
            }
            out.putMap("matchingRowsByVariant", matchingRows)

            recordLastBlockedPhoneLookup(
                originalInput = lookup.originalInput,
                canonical = lookup.canonical,
                variants = lookup.variants,
                matchingRowsByVariant = lookup.matchingRowsByVariant,
                finalDecision = lookup.finalDecision,
                matchedVariant = lookup.matchedVariant,
                matchedRow = lookup.matchedRow,
            )
        } catch (e: Exception) {
            out.putString("error", e.message ?: "unknown")
            out.putString("decision", "ALLOW")
            out.putString("finalDecision", "ALLOW")
            out.putString("reason", "lookup_error")
        } finally {
            try {
                db?.close()
            } catch (_: Exception) {
                // ignore
            }
            val dt = (SystemClock.elapsedRealtime() - t0).toDouble()
            out.putDouble("lookupDurationMs", dt)
            promise.resolve(out)
        }
    }

    // ========================
    // DEBUG: Native blocked/spam rows for UI inspection
    // local_blocked = 1 OR risk_level >= 60
    // ========================
    @ReactMethod
    fun getNativeBlockedList(promise: Promise) {
        val dbFile = getDbFile()
        val dbPath = dbFile.absolutePath

        val out = Arguments.createMap()
        out.putString("dbPath", dbPath)
        out.putString("dbName", DB_NAME)
        out.putString("table", "scam_phones")
        out.putInt("total", 0)
        out.putArray("rows", Arguments.createArray())

        // Debug-only by default; allow in release when hidden diagnostics is enabled.
        if (!diagnosticsEnabled()) {
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

            db.beginTransaction()
            try {
                cleanupInconsistentLocalBlockedRows(db)
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
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
        val dbFile = getDbFile()
        val dbPath = dbFile.absolutePath
        val preferredTable = "scam_phones"
        val diagEnabled = diagnosticsEnabled()

        val out = Arguments.createMap()
        out.putString("dbName", DB_NAME)
        out.putString("dbPath", dbPath)
        out.putString("dbDir", dbFile.parentFile?.absolutePath ?: "")
        out.putString("packageName", reactContext.packageName)
        out.putBoolean("fileExists", dbFile.exists())
        out.putDouble("fileSizeBytes", dbFile.length().toDouble())
        out.putString("pragmaMainPath", "")
        out.putString("tableUsed", "")
        out.putArray("tables", Arguments.createArray())
        out.putMap("tableCounts", Arguments.createMap())
        out.putMap("schemaInfo", Arguments.createMap())
        out.putString("debugError", "")
        out.putArray("debugWarnings", Arguments.createArray())

        // Deep debug payload (for device-only issues)
        out.putInt("rawCountBeforeFilter", 0)
        out.putInt("rawTableCount", 0)
        out.putMap("appliedQueries", Arguments.createMap())
        out.putMap("appliedFilters", Arguments.createMap())
        out.putArray("sampleRows", Arguments.createArray())
        out.putArray("localRowsPreview", Arguments.createArray())
        out.putArray("globalRowsPreview", Arguments.createArray())
        out.putArray("rawRows", Arguments.createArray())
        // last write diagnostics
        out.putDouble("lastWriteTs", lastWriteTs.toDouble())
        out.putString("lastWriteAction", lastWriteAction ?: "")
        out.putString("lastWriteDbPath", lastWriteDbPath ?: "")
        out.putInt("lastWriteRowsAffected", lastWriteRowsAffected ?: 0)
        out.putString("lastWriteError", lastWriteError ?: "")

        // deep write proof
        out.putString("writeDbName", lastWriteDbName ?: "")
        out.putString("writeDbPath", lastWriteDbPath ?: "")
        out.putString("writeTableName", lastWriteTable ?: "")
        out.putString("writeSql", lastWriteSql ?: "")
        out.putString("writeArgs", lastWriteArgs ?: "")
        out.putBoolean("transactionCommitted", lastWriteCommitted)
        out.putDouble("insertResultRowId", lastWriteInsertRowId.toDouble())
        out.putInt("rowsAffected", lastWriteUpdateChanges)
        out.putInt("countFromWriteTableAfterWrite", lastWriteCountAfter)
        out.putString("sampleRowsFromWriteTableAfterWrite", lastWriteSample ?: "")
        out.putString("phone_normalized", lastWritePhoneNormalized ?: "")
        out.putBoolean("didInsert", lastWriteDidInsert)
        out.putBoolean("didUpdate", lastWriteDidUpdate)
        out.putString("matchedRowAfterWrite", lastWriteMatchedRow ?: "")
        out.putInt("totalCount", 0)
        out.putInt("localCount", 0)
        out.putInt("globalCount", 0)
        out.putArray("local", Arguments.createArray())
        out.putArray("global", Arguments.createArray())

        logDbDiag("getNativeBlockDebugData ENTER")

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

        fun hasAny(cols: Set<String>, vararg names: String): Boolean {
            for (n in names) if (cols.contains(n)) return true
            return false
        }

        fun localExpr(cols: Set<String>): String {
            // tolerant boolean: supports INTEGER 0/1 and TEXT true/false
            if (!cols.contains("local_blocked")) return "0"
            return "(CAST(local_blocked AS INTEGER) = 1 OR lower(CAST(local_blocked AS TEXT)) IN ('true','yes','y'))"
        }

        fun notLocalExpr(cols: Set<String>): String {
            if (!cols.contains("local_blocked")) return "1"
            return "(local_blocked IS NULL OR CAST(local_blocked AS INTEGER) = 0 OR lower(CAST(local_blocked AS TEXT)) IN ('false','no','n',''))"
        }

        fun aliveExpr(cols: Set<String>): String {
            if (!cols.contains("server_deleted")) return "1"
            return "(CAST(server_deleted AS INTEGER) = 0 OR server_deleted IS NULL OR lower(CAST(server_deleted AS TEXT)) IN ('0','false','no','n',''))"
        }

        fun listTables(db: SQLiteDatabase): List<String> {
            val outList = ArrayList<String>()
            val cur = db.rawQuery(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                null
            )
            cur.use { c ->
                val idx = c.getColumnIndex("name")
                while (c.moveToNext()) {
                    if (idx >= 0 && !c.isNull(idx)) outList.add(c.getString(idx))
                }
            }
            return outList
        }

        fun countAll(db: SQLiteDatabase, tableName: String): Int {
            val cur = db.rawQuery("SELECT COUNT(*) AS c FROM $tableName", null)
            cur.use { c ->
                return if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
            }
        }

        fun countWhere(db: SQLiteDatabase, tableName: String, whereSql: String): Int {
            val cur = db.rawQuery("SELECT COUNT(*) AS c FROM $tableName WHERE $whereSql", null)
            cur.use { c ->
                return if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
            }
        }

        fun queryRows(db: SQLiteDatabase, tableName: String, cols: Set<String>, whereSql: String, limit: Int): WritableArray {
            val phoneCol = pickPhoneColumn(cols)
            if (phoneCol.isNullOrBlank()) return Arguments.createArray()

            val selectCols = ArrayList<String>()

            // Prefer showing id-like columns if available
            if (cols.contains("id")) selectCols.add("id")
            selectCols.add(phoneCol)

            if (cols.contains("risk_level")) selectCols.add("risk_level")
            if (cols.contains("local_blocked")) selectCols.add("local_blocked")
            if (cols.contains("server_deleted")) selectCols.add("server_deleted")
            if (cols.contains("report_count")) selectCols.add("report_count")
            if (cols.contains("last_report_at")) selectCols.add("last_report_at")
            if (cols.contains("tags")) selectCols.add("tags")
            if (cols.contains("raw_phone")) selectCols.add("raw_phone")
            if (cols.contains("rawPhone")) selectCols.add("rawPhone")
            if (cols.contains("created_at")) selectCols.add("created_at")
            if (cols.contains("updated_at")) selectCols.add("updated_at")
            if (cols.contains("server_updated_at")) selectCols.add("server_updated_at")

            val order = when {
                cols.contains("risk_level") -> "risk_level DESC, $phoneCol ASC"
                else -> "$phoneCol ASC"
            }

            val sql = "SELECT ${selectCols.joinToString(", ")} FROM $tableName WHERE $whereSql ORDER BY $order LIMIT $limit"
            val arr = Arguments.createArray()

            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                val idxId = if (cols.contains("id")) c.getColumnIndex("id") else -1
                val idxPhone = c.getColumnIndex(phoneCol)
                val idxRisk = c.getColumnIndex("risk_level")
                val idxLocal = c.getColumnIndex("local_blocked")
                val idxDeleted = c.getColumnIndex("server_deleted")
                val idxReportCount = c.getColumnIndex("report_count")
                val idxLastReportAt = c.getColumnIndex("last_report_at")
                val idxTags = c.getColumnIndex("tags")
                val idxRawPhone = if (cols.contains("raw_phone")) c.getColumnIndex("raw_phone") else c.getColumnIndex("rawPhone")
                val idxCreatedAt = if (cols.contains("created_at")) c.getColumnIndex("created_at") else -1
                val idxUpdatedAt = if (cols.contains("updated_at")) c.getColumnIndex("updated_at") else -1
                val idxServerUpdatedAt = if (cols.contains("server_updated_at")) c.getColumnIndex("server_updated_at") else -1

                while (c.moveToNext()) {
                    val m = Arguments.createMap()

                    val phone = if (idxPhone >= 0 && !c.isNull(idxPhone)) c.getString(idxPhone) else ""
                    val risk = if (idxRisk >= 0 && !c.isNull(idxRisk)) c.getInt(idxRisk) else 0
                    val local = if (idxLocal >= 0 && !c.isNull(idxLocal)) c.getInt(idxLocal) else 0
                    val deleted = if (idxDeleted >= 0 && !c.isNull(idxDeleted)) c.getInt(idxDeleted) else 0

                    if (idxId >= 0 && !c.isNull(idxId)) m.putInt("id", c.getInt(idxId))
                    m.putString("phone", phone)
                    if (idxRawPhone >= 0 && !c.isNull(idxRawPhone)) m.putString("rawPhone", c.getString(idxRawPhone))
                    m.putInt("riskLevel", risk)
                    m.putBoolean("localBlocked", local == 1)
                    m.putInt("serverDeleted", deleted)

                    if (idxReportCount >= 0 && !c.isNull(idxReportCount)) m.putInt("reportCount", c.getInt(idxReportCount))
                    if (idxLastReportAt >= 0 && !c.isNull(idxLastReportAt)) m.putString("lastReportAt", c.getString(idxLastReportAt))
                    if (idxTags >= 0 && !c.isNull(idxTags)) m.putString("tags", c.getString(idxTags))

                    if (idxCreatedAt >= 0 && !c.isNull(idxCreatedAt)) m.putString("createdAt", c.getString(idxCreatedAt))
                    if (idxUpdatedAt >= 0 && !c.isNull(idxUpdatedAt)) m.putString("updatedAt", c.getString(idxUpdatedAt))
                    if (idxServerUpdatedAt >= 0 && !c.isNull(idxServerUpdatedAt)) m.putString("serverUpdatedAt", c.getString(idxServerUpdatedAt))

                    arr.pushMap(m)
                }
            }

            return arr
        }

        fun queryRawRows(db: SQLiteDatabase, tableName: String, limit: Int): WritableArray {
            val arr = Arguments.createArray()
            val sql = "SELECT id, phone_normalized, local_blocked, risk_level, report_count, server_deleted, server_updated_at FROM $tableName ORDER BY id DESC LIMIT $limit"
            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                val idxId = c.getColumnIndex("id")
                val idxPhone = c.getColumnIndex("phone_normalized")
                val idxLocal = c.getColumnIndex("local_blocked")
                val idxRisk = c.getColumnIndex("risk_level")
                val idxReport = c.getColumnIndex("report_count")
                val idxDeleted = c.getColumnIndex("server_deleted")
                val idxUpdated = c.getColumnIndex("server_updated_at")

                while (c.moveToNext()) {
                    val m = Arguments.createMap()
                    if (idxId >= 0 && !c.isNull(idxId)) m.putInt("id", c.getInt(idxId))
                    val phone = if (idxPhone >= 0 && !c.isNull(idxPhone)) c.getString(idxPhone) else ""
                    val localRaw = if (idxLocal >= 0 && !c.isNull(idxLocal)) c.getInt(idxLocal) else 0
                    val risk = if (idxRisk >= 0 && !c.isNull(idxRisk)) c.getInt(idxRisk) else 0
                    val rep = if (idxReport >= 0 && !c.isNull(idxReport)) c.getInt(idxReport) else 0
                    val del = if (idxDeleted >= 0 && !c.isNull(idxDeleted)) c.getInt(idxDeleted) else 0
                    val upd = if (idxUpdated >= 0 && !c.isNull(idxUpdated)) c.getString(idxUpdated) else null

                    m.putString("phone", phone)
                    m.putBoolean("localBlocked", localRaw == 1)
                    m.putInt("localBlockedRaw", localRaw)
                    m.putInt("riskLevel", risk)
                    m.putInt("reportCount", rep)
                    m.putInt("serverDeleted", del)
                    if (upd != null) m.putString("serverUpdatedAt", upd)
                    arr.pushMap(m)
                }
            }
            return arr
        }

        fun pickBestTable(tables: List<String>, colsByTable: Map<String, Set<String>>, counts: Map<String, Int>): String? {
            if (tables.isEmpty()) return null

            // Prefer scam_phones if it exists and has rows.
            val preferredCount = counts[preferredTable]
            if (preferredCount != null && preferredCount > 0) return preferredTable

            var best: String? = null
            var bestScore = -1
            for (t in tables) {
                val cols = colsByTable[t] ?: emptySet()
                val c = counts[t] ?: 0

                var score = 0
                if (cols.contains("phone_normalized")) score += 50
                if (cols.contains("phone")) score += 15
                if (cols.contains("risk_level")) score += 10
                if (cols.contains("local_blocked")) score += 10
                if (cols.contains("server_deleted")) score += 5
                if (t.contains("scam", ignoreCase = true)) score += 8
                if (t.contains("phone", ignoreCase = true)) score += 4
                if (c > 0) score += 30

                if (score > bestScore) {
                    bestScore = score
                    best = t
                }
            }
            return best
        }

        try {
            if (!dbFile.exists()) {
                emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "getNativeBlockDebugData DB_NOT_FOUND",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = preferredTable,
                    action = "NATIVE_DEBUG_DB_NOT_FOUND",
                )
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "getNativeBlockDebugData DB_OPEN_FAILED",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = preferredTable,
                    action = "NATIVE_DEBUG_DB_OPEN_FAILED",
                )
                promise.resolve(out)
                return
            }

            db.beginTransaction()
            try {
                cleanupInconsistentLocalBlockedRows(db)
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }

            try {
                if (diagEnabled) {
                    val cur = db.rawQuery("PRAGMA database_list", null)
                    cur.use { c ->
                        val nameIdx = c.getColumnIndex("name")
                        val fileIdx = c.getColumnIndex("file")
                        while (c.moveToNext()) {
                            val n = if (nameIdx >= 0 && !c.isNull(nameIdx)) c.getString(nameIdx) else ""
                            val f = if (fileIdx >= 0 && !c.isNull(fileIdx)) c.getString(fileIdx) else ""
                            if (n == "main") {
                                out.putString("pragmaMainPath", f)
                                break
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // ignore
            }

            // Tables + schema + counts (debug)
            val tables = try { listTables(db) } catch (_: Exception) { emptyList() }
            val tablesArr = Arguments.createArray()
            val countsMap = Arguments.createMap()
            val schemaMap = Arguments.createMap()

            val colsByTable = LinkedHashMap<String, Set<String>>()
            val countsByTable = LinkedHashMap<String, Int>()

            for (t in tables) {
                val cols = try { readTableColumns(db, t) } catch (_: Exception) { emptySet() }
                colsByTable[t] = cols

                if (diagEnabled) {
                    tablesArr.pushString(t)
                    val colsArr = Arguments.createArray()
                    for (cName in cols) colsArr.pushString(cName)
                    schemaMap.putArray(t, colsArr)
                }

                val cAll = try { countAll(db, t) } catch (_: Exception) { -1 }
                if (cAll >= 0) {
                    countsByTable[t] = cAll
                    if (diagEnabled) {
                        countsMap.putInt(t, cAll)
                    }
                }
            }

            if (diagEnabled) {
                out.putArray("tables", tablesArr)
                out.putMap("tableCounts", countsMap)
                out.putMap("schemaInfo", schemaMap)
            }

            if (diagEnabled) {
                // RAW tab: show direct scam_phones rows when available (no business filters)
                if (tables.contains(preferredTable)) {
                    val rawTableCount = try { countAll(db, preferredTable) } catch (_: Exception) { 0 }
                    out.putInt("rawTableCount", rawTableCount)
                    val rawRows = try { queryRawRows(db, preferredTable, 100) } catch (_: Exception) { Arguments.createArray() }
                    out.putArray("rawRows", rawRows)
                } else {
                    // fall back to tableUsed later if scam_phones not present
                    out.putInt("rawTableCount", 0)
                    out.putArray("rawRows", Arguments.createArray())
                }
            }

            val tableUsed = pickBestTable(tables, colsByTable, countsByTable)
            if (tableUsed.isNullOrBlank()) {
                out.putString("debugError", "No tables found in sqlite_master")
                db.close()
                promise.resolve(out)
                return
            }
            out.putString("tableUsed", tableUsed)

            if (diagEnabled) {
                // If scam_phones didn't exist, still provide RAW fallback from the chosen table.
                if (!tables.contains(preferredTable)) {
                    val rawTableCount = try { countAll(db, tableUsed) } catch (_: Exception) { 0 }
                    out.putInt("rawTableCount", rawTableCount)
                    val rawRows = try { queryRawRows(db, tableUsed, 100) } catch (_: Exception) { Arguments.createArray() }
                    out.putArray("rawRows", rawRows)
                }
            }

            val columns = colsByTable[tableUsed] ?: readTableColumns(db, tableUsed)

            val warnings = Arguments.createArray()
            if (diagEnabled) {
                if (!columns.contains("phone_normalized") && !columns.contains("phone") && !columns.contains("phoneNumber") && !columns.contains("number")) {
                    warnings.pushString("No phone column found in table '$tableUsed'")
                }
                if (!columns.contains("local_blocked")) warnings.pushString("Missing column local_blocked")
                if (!columns.contains("server_deleted")) warnings.pushString("Missing column server_deleted")
                if (!columns.contains("risk_level")) warnings.pushString("Missing column risk_level")
                if (tableUsed != preferredTable) warnings.pushString("Using table '$tableUsed' instead of preferred '$preferredTable'")
            }

            // Raw count before filters
            val rawCount = try { countAll(db, tableUsed) } catch (_: Exception) { 0 }
            out.putInt("rawCountBeforeFilter", rawCount)

            val qMap = Arguments.createMap()
            val fMap = Arguments.createMap()

            val localWhere = localExpr(columns)
            val globalWhere = "${notLocalExpr(columns)} AND ${aliveExpr(columns)}"
            if (diagEnabled) {
                fMap.putString("local", "LOCAL = $localWhere")
                fMap.putString("global", "GLOBAL = $globalWhere")
                out.putMap("appliedFilters", fMap)

                qMap.putString("rawCount", "SELECT COUNT(*) FROM $tableUsed")
                qMap.putString("localCount", "SELECT COUNT(*) FROM $tableUsed WHERE $localWhere")
                qMap.putString("globalCount", "SELECT COUNT(*) FROM $tableUsed WHERE $globalWhere")
                qMap.putString("sampleRows", "SELECT ... FROM $tableUsed LIMIT 10")
                out.putMap("appliedQueries", qMap)

                // Sample rows before filtering
                val sampleRows = try { queryRows(db, tableUsed, columns, "1=1", 10) } catch (_: Exception) { Arguments.createArray() }
                out.putArray("sampleRows", sampleRows)
            }
            val localCount = try { countWhere(db, tableUsed, localWhere) } catch (_: Exception) { 0 }
            val globalCount = try { countWhere(db, tableUsed, globalWhere) } catch (_: Exception) { 0 }
            val totalCount = localCount + globalCount

            if (diagEnabled) {
                // previews
                val localPreview = try { queryRows(db, tableUsed, columns, localWhere, 10) } catch (_: Exception) { Arguments.createArray() }
                val globalPreview = try { queryRows(db, tableUsed, columns, globalWhere, 10) } catch (_: Exception) { Arguments.createArray() }
                out.putArray("localRowsPreview", localPreview)
                out.putArray("globalRowsPreview", globalPreview)

                if (rawCount > 0 && totalCount == 0) {
                    warnings.pushString("rawCountBeforeFilter > 0 but local+global matched 0 (filter mismatch)")
                }
                out.putArray("debugWarnings", warnings)

                // Tagged summary logs
                emitCallDebug(
                    source = "DB_DEBUG",
                    msg = "COUNTS raw=$rawCount total=$totalCount local=$localCount global=$globalCount table=$tableUsed",
                    dbName = DB_NAME,
                    dbPath = dbPath,
                    table = tableUsed,
                    rowsFound = totalCount,
                    action = "DB_DEBUG_COUNTS",
                )
            }

            // Render limit to keep UI responsive; counts still reflect full totals.
            val limit = 5000
            val localRows = try { queryRows(db, tableUsed, columns, localWhere, limit) } catch (_: Exception) { Arguments.createArray() }
            val globalRows = try { queryRows(db, tableUsed, columns, globalWhere, limit) } catch (_: Exception) { Arguments.createArray() }

            db.close()

            out.putInt("totalCount", totalCount)
            out.putInt("localCount", localCount)
            out.putInt("globalCount", globalCount)
            out.putArray("local", localRows)
            out.putArray("global", globalRows)

            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "[getNativeBlockDebugData] ERROR", e)
            out.putString("debugError", e.message ?: "unknown")
            promise.resolve(out)
        }
    }

    // ========================
    // DEBUG: SQLite Inspector (no business filters)
    // - Lists ALL tables from sqlite_master (including sqlite_*)
    // - Row count per table
    // - Optional schema + sample rows for selected table
    // ========================
    @ReactMethod
    fun inspectDb(tableName: String?, promise: Promise) {
        val dbFile = getDbFile()
        val dbPath = dbFile.absolutePath

        val out = Arguments.createMap()
        out.putString("dbName", DB_NAME)
        out.putString("dbPath", dbPath)
        out.putArray("tablesWithCounts", Arguments.createArray())
        out.putArray("selectedTableSchema", Arguments.createArray())
        out.putArray("selectedTableRows", Arguments.createArray())
        out.putString("selectedTable", tableName ?: "")
        out.putString("error", "")

        // Debug-only by default; allow in release when hidden diagnostics is enabled.
        if (!diagnosticsEnabled()) {
            promise.resolve(out)
            return
        }

        if (!dbFile.exists()) {
            out.putString("error", "db not found")
            promise.resolve(out)
            return
        }

        fun quoteIdent(name: String): String {
            // Safely quote a SQLite identifier (table name).
            // Allows odd table names while preventing SQL breakage.
            val safe = name.replace("\"", "\"\"")
            return "\"$safe\""
        }

        fun listAllTables(db: SQLiteDatabase): List<String> {
            val list = ArrayList<String>()
            val sql = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                val idx = c.getColumnIndex("name")
                while (c.moveToNext()) {
                    if (idx >= 0 && !c.isNull(idx)) list.add(c.getString(idx))
                }
            }
            return list
        }

        fun countTable(db: SQLiteDatabase, table: String): Int {
            val sql = "SELECT COUNT(*) AS c FROM ${quoteIdent(table)}"
            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                return if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) else 0
            }
        }

        fun readTableSchema(db: SQLiteDatabase, table: String): WritableArray {
            val arr = Arguments.createArray()
            val sql = "PRAGMA table_info(${DatabaseUtils.sqlEscapeString(table)})"
            val cur = db.rawQuery(sql, null)
            cur.use { c ->
                val idxName = c.getColumnIndex("name")
                val idxType = c.getColumnIndex("type")
                val idxPk = c.getColumnIndex("pk")
                val idxNotNull = c.getColumnIndex("notnull")

                while (c.moveToNext()) {
                    val m = Arguments.createMap()
                    if (idxName >= 0 && !c.isNull(idxName)) m.putString("name", c.getString(idxName))
                    if (idxType >= 0 && !c.isNull(idxType)) m.putString("type", c.getString(idxType))
                    if (idxPk >= 0 && !c.isNull(idxPk)) m.putInt("pk", c.getInt(idxPk))
                    if (idxNotNull >= 0 && !c.isNull(idxNotNull)) m.putInt("notnull", c.getInt(idxNotNull))
                    arr.pushMap(m)
                }
            }
            return arr
        }

        fun cursorToRows(cur: Cursor): WritableArray {
            val arr = Arguments.createArray()
            val names = cur.columnNames
            while (cur.moveToNext()) {
                val m = Arguments.createMap()
                for (i in names.indices) {
                    val k = names[i]
                    try {
                        when (cur.getType(i)) {
                            Cursor.FIELD_TYPE_NULL -> m.putNull(k)
                            Cursor.FIELD_TYPE_INTEGER -> m.putDouble(k, cur.getLong(i).toDouble())
                            Cursor.FIELD_TYPE_FLOAT -> m.putDouble(k, cur.getDouble(i))
                            Cursor.FIELD_TYPE_STRING -> m.putString(k, cur.getString(i))
                            Cursor.FIELD_TYPE_BLOB -> {
                                val b = cur.getBlob(i)
                                m.putString(k, "<BLOB ${b?.size ?: 0} bytes>")
                            }
                            else -> m.putString(k, cur.getString(i))
                        }
                    } catch (e: Exception) {
                        m.putString(k, "<ERR: ${e.message}>")
                    }
                }
                arr.pushMap(m)
            }
            return arr
        }

        fun readTableRows(db: SQLiteDatabase, table: String, limit: Int): WritableArray {
            val quoted = quoteIdent(table)
            val sqlPrimary = "SELECT * FROM $quoted ORDER BY rowid DESC LIMIT $limit"
            try {
                val cur = db.rawQuery(sqlPrimary, null)
                cur.use { c ->
                    return cursorToRows(c)
                }
            } catch (_: Exception) {
                val sqlFallback = "SELECT * FROM $quoted LIMIT $limit"
                val cur = db.rawQuery(sqlFallback, null)
                cur.use { c ->
                    return cursorToRows(c)
                }
            }
        }

        val db = openDb() ?: run {
            out.putString("error", "db open failed")
            promise.resolve(out)
            return
        }

        try {
            val tables = listAllTables(db)
            val set = HashSet<String>()
            for (t in tables) set.add(t)

            val tablesArr = Arguments.createArray()
            for (t in tables) {
                val m = Arguments.createMap()
                m.putString("name", t)
                try {
                    val c = countTable(db, t)
                    m.putInt("count", c)
                } catch (e: Exception) {
                    m.putInt("count", -1)
                    m.putString("error", e.message ?: "count failed")
                }
                tablesArr.pushMap(m)
            }
            out.putArray("tablesWithCounts", tablesArr)

            val selected = (tableName ?: "").trim()
            if (selected.isNotEmpty()) {
                if (!set.contains(selected)) {
                    out.putString("error", "unknown table: $selected")
                } else {
                    out.putString("selectedTable", selected)
                    try {
                        out.putArray("selectedTableSchema", readTableSchema(db, selected))
                    } catch (e: Exception) {
                        out.putString("error", "schema error: ${e.message}")
                    }
                    try {
                        out.putArray("selectedTableRows", readTableRows(db, selected, 50))
                    } catch (e: Exception) {
                        out.putString("error", "rows error: ${e.message}")
                    }
                }
            }

            promise.resolve(out)
        } catch (e: Exception) {
            out.putString("error", e.message ?: "unknown")
            promise.resolve(out)
        } finally {
            try {
                db.close()
            } catch (_: Exception) {
                // ignore
            }
        }
    }

    // ========================
    // DEBUG EXPORT: Full SQLite dump + read/write context
    // Returns a single JSON TEXT payload for easy copy.
    // ========================
    @ReactMethod
    fun exportDbDebug(promise: Promise) {
        // Debug-only by default; allow in release when hidden diagnostics is enabled.
        if (!diagnosticsEnabled()) {
            promise.reject("DIAG_DISABLED", "exportDbDebug requires hidden diagnostics mode")
            return
        }

        fun quoteIdent(name: String): String {
            val safe = name.replace("\"", "\"\"")
            return "\"$safe\""
        }

        fun cursorRowToJson(cur: Cursor, index: Int): Any {
            return try {
                when (cur.getType(index)) {
                    Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
                    Cursor.FIELD_TYPE_INTEGER -> cur.getLong(index)
                    Cursor.FIELD_TYPE_FLOAT -> cur.getDouble(index)
                    Cursor.FIELD_TYPE_STRING -> cur.getString(index)
                    Cursor.FIELD_TYPE_BLOB -> {
                        val b = cur.getBlob(index)
                        "<BLOB ${b?.size ?: 0} bytes>"
                    }
                    else -> cur.getString(index)
                }
            } catch (e: Exception) {
                "<ERR: ${e.message}>"
            }
        }

        fun queryToJsonArray(db: SQLiteDatabase, sql: String, args: Array<String>? = null, limitRows: Int? = null): JSONArray {
            val arr = JSONArray()
            val cur = db.rawQuery(sql, args)
            cur.use { c ->
                val cols = c.columnNames
                var n = 0
                while (c.moveToNext()) {
                    val row = JSONObject()
                    for (i in cols.indices) {
                        row.put(cols[i], cursorRowToJson(c, i))
                    }
                    arr.put(row)
                    n++
                    if (limitRows != null && n >= limitRows) break
                }
            }
            return arr
        }

        fun queryLong(db: SQLiteDatabase, sql: String, args: Array<String>? = null): Long {
            val cur = db.rawQuery(sql, args)
            cur.use { c ->
                return if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L
            }
        }

        fun listTables(db: SQLiteDatabase): List<String> {
            val out = ArrayList<String>()
            val cur = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", null)
            cur.use { c ->
                val idx = c.getColumnIndex("name")
                while (c.moveToNext()) {
                    if (idx >= 0 && !c.isNull(idx)) out.add(c.getString(idx))
                }
            }
            return out
        }

        fun tableInfo(db: SQLiteDatabase, table: String): JSONArray {
            // Use string-escaped table name (PRAGMA expects literal string in this form).
            val sql = "PRAGMA table_info(${DatabaseUtils.sqlEscapeString(table)})"
            return queryToJsonArray(db, sql, null, null)
        }

        fun sampleRows(db: SQLiteDatabase, table: String, limit: Int): JSONArray {
            val sql = "SELECT * FROM ${quoteIdent(table)} LIMIT $limit"
            return queryToJsonArray(db, sql, null, null)
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

        fun localExpr(cols: Set<String>): String {
            if (!cols.contains("local_blocked")) return "0"
            return "(CAST(local_blocked AS INTEGER) = 1 OR lower(CAST(local_blocked AS TEXT)) IN ('true','yes','y'))"
        }

        fun notLocalExpr(cols: Set<String>): String {
            if (!cols.contains("local_blocked")) return "1"
            return "(local_blocked IS NULL OR CAST(local_blocked AS INTEGER) = 0 OR lower(CAST(local_blocked AS TEXT)) IN ('false','no','n',''))"
        }

        fun aliveExpr(cols: Set<String>): String {
            if (!cols.contains("server_deleted")) return "1"
            return "(CAST(server_deleted AS INTEGER) = 0 OR server_deleted IS NULL OR lower(CAST(server_deleted AS TEXT)) IN ('0','false','no','n',''))"
        }

        fun pickBestTable(tables: List<String>, countsByTable: Map<String, Long>, preferred: String): String? {
            if (tables.isEmpty()) return null
            val preferredCount = countsByTable[preferred]
            if (preferredCount != null && preferredCount > 0) return preferred
            // fall back to preferred if exists, else first.
            if (tables.contains(preferred)) return preferred
            return tables.firstOrNull()
        }

        try {
            val dbFile = getDbFile()

            val root = JSONObject()
            val dbInfo = JSONObject()
            dbInfo.put("dbName", DB_NAME)
            dbInfo.put("dbPath", dbFile.absolutePath)
            dbInfo.put("fileExists", dbFile.exists())
            dbInfo.put("fileSize", dbFile.length())
            dbInfo.put("packageName", reactContext.packageName)
            root.put("databaseInfo", dbInfo)

            val warnings = JSONArray()
            root.put("warnings", warnings)

            if (!dbFile.exists()) {
                warnings.put("DB file does not exist yet")
                val text = root.toString(2)
                promise.resolve(text)
                return
            }

            val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)

            // 2) ALL TABLES + counts
            val tables = listTables(db)
            val tablesArr = JSONArray()
            val countsByTable = LinkedHashMap<String, Long>()
            val schemasByTable = JSONObject()
            val samplesByTable = JSONObject()

            for (t in tables) {
                val tableObj = JSONObject()
                tableObj.put("name", t)
                val countSql = "SELECT COUNT(*) AS c FROM ${quoteIdent(t)}"
                val rowCount = try { queryLong(db, countSql, null) } catch (_: Exception) { -1L }
                tableObj.put("rowCount", rowCount)
                tableObj.put("rowCountQuery", countSql)
                tablesArr.put(tableObj)
                if (rowCount >= 0) countsByTable[t] = rowCount

                // 3) schema
                val schema = try { tableInfo(db, t) } catch (_: Exception) { JSONArray() }
                schemasByTable.put(t, schema)

                // 4) sample rows
                val sample = try { sampleRows(db, t, 20) } catch (_: Exception) { JSONArray() }
                samplesByTable.put(t, sample)
            }
            root.put("tables", tablesArr)
            root.put("schemas", schemasByTable)
            root.put("samples", samplesByTable)

            // 5) EXACT READ QUERIES USED BY THE SCREEN (from native classification)
            val preferredTable = "scam_phones"
            val tableUsed = pickBestTable(tables, countsByTable, preferredTable)
            val screen = JSONObject()
            screen.put("preferredTable", preferredTable)
            screen.put("tableUsed", tableUsed ?: JSONObject.NULL)

            if (!tableUsed.isNullOrBlank()) {
                val cols = try { readTableColumns(db, tableUsed) } catch (_: Exception) { emptySet() }
                val localWhere = localExpr(cols)
                val globalWhere = "${notLocalExpr(cols)} AND ${aliveExpr(cols)}"

                val allCountSql = "SELECT COUNT(*) AS c FROM ${quoteIdent(tableUsed)}"
                val rawCountSql = allCountSql
                val localCountSql = "SELECT COUNT(*) AS c FROM ${quoteIdent(tableUsed)} WHERE $localWhere"
                val globalCountSql = "SELECT COUNT(*) AS c FROM ${quoteIdent(tableUsed)} WHERE $globalWhere"

                val allCount = try { queryLong(db, allCountSql, null) } catch (_: Exception) { -1L }
                val rawCount = try { queryLong(db, rawCountSql, null) } catch (_: Exception) { -1L }
                val localCount = try { queryLong(db, localCountSql, null) } catch (_: Exception) { -1L }
                val globalCount = try { queryLong(db, globalCountSql, null) } catch (_: Exception) { -1L }

                screen.put("rawQuery", rawCountSql)
                screen.put("localQuery", localCountSql)
                screen.put("globalQuery", globalCountSql)
                screen.put("allQuery", allCountSql)
                screen.put("rawCount", rawCount)
                screen.put("localCount", localCount)
                screen.put("globalCount", globalCount)
                screen.put("allCount", allCount)
                screen.put("localWhere", localWhere)
                screen.put("globalWhere", globalWhere)

                if (rawCount > 0 && (localCount + globalCount) == 0L) {
                    warnings.put("rawCount > 0 but localCount+globalCount == 0 (screen filters may hide all rows)")
                }
                if (allCount >= 0 && rawCount >= 0 && allCount != rawCount) {
                    warnings.put("allCount != rawCount (unexpected: raw is unfiltered allCount)")
                }
            } else {
                warnings.put("No tables found for screen read classification")
            }
            root.put("screenReadQueries", screen)

            // 6) LAST WRITE DEBUG
            val lastWrite = JSONObject()
            lastWrite.put("lastWriteAction", lastWriteAction ?: "")
            lastWrite.put("writeDbPath", lastWriteDbPath ?: "")
            lastWrite.put("writeTableName", lastWriteTable ?: "")
            lastWrite.put("writeSql", lastWriteSql ?: "")
            lastWrite.put("writeArgs", lastWriteArgs ?: "")
            lastWrite.put("transactionCommitted", lastWriteCommitted)
            lastWrite.put("rowsAffected", lastWriteUpdateChanges)
            lastWrite.put("insertRowId", lastWriteInsertRowId)
            lastWrite.put("countAfterWrite", lastWriteCountAfter)
            root.put("lastWriteDebug", lastWrite)

            // 7) LAST BLOCKED PHONE LOOKUP (variants + matching rows)
            val lookup = JSONObject()
            lookup.put("originalInput", lastBlockedInputRaw ?: "")
            lookup.put("canonical", lastBlockedCanonical ?: "")
            val vArr = JSONArray()
            val vList = lastBlockedVariants ?: emptyList()
            for (v in vList) vArr.put(v)
            lookup.put("variants", vArr)

            val matches = try {
                val raw = (lastBlockedMatchingRowsByVariantJson ?: "").trim()
                if (raw.isNotEmpty()) JSONObject(raw) else JSONObject()
            } catch (_: Exception) {
                JSONObject()
            }
            if (!tables.contains(preferredTable)) {
                warnings.put("Table 'scam_phones' not found; cannot run last lookup queries")
            }
            if (vList.isEmpty()) {
                warnings.put("No lastBlocked variants captured yet (screen a call or run Lookup Number first)")
            }
            lookup.put("matchingRowsByVariant", matches)
            lookup.put("finalDecision", lastBlockedFinalDecision ?: "")
            lookup.put("matchedVariant", lastBlockedMatchedVariant ?: "")
            val matchedRowObj = try {
                val raw = (lastBlockedMatchedRowJson ?: "").trim()
                if (raw.isNotEmpty()) JSONObject(raw) else JSONObject()
            } catch (_: Exception) {
                JSONObject()
            }
            lookup.put("matchedRow", matchedRowObj)
            root.put("lastBlockedPhoneLookup", lookup)

            // 8) WARNINGS based on contradictions
            val writeTableName = (lastWriteTable ?: "").trim()
            val readTableName = try { screen.optString("tableUsed", "") } catch (_: Exception) { "" }
            if (writeTableName.isNotEmpty() && readTableName.isNotEmpty() && writeTableName != readTableName) {
                warnings.put("writeTableName differs from screen tableUsed: write='$writeTableName' read='$readTableName'")
            }

            if (lastWriteCommitted && (lastBlockedCanonical ?: "").isNotBlank() && tables.contains(preferredTable)) {
                val canon = (lastBlockedCanonical ?: "").trim()
                if (canon.isNotEmpty()) {
                    val found = try {
                        queryLong(
                            db,
                            "SELECT COUNT(*) AS c FROM ${quoteIdent(preferredTable)} WHERE phone_normalized = ?",
                            arrayOf(canon)
                        )
                    } catch (_: Exception) {
                        0L
                    }
                    if (found <= 0L) {
                        warnings.put("write committed but canonical phone not found in scam_phones (phone_normalized='$canon')")
                    }
                }
            }

            db.close()

            val text = root.toString(2)
            promise.resolve(text)
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", e)
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

        // NOTE: This is a user-facing action (unblock). It must work on physical devices in release builds.
        // Keep the logic minimal and safe: only updates local_blocked for matching phone variants.

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
            val variants = PhoneUtils.variantsFromRaw(input).toList()

            DiagnosticsStore.record(
                context = reactContext,
                topic = "NATIVE_UNBLOCK",
                msg = "ENTER",
                data = mapOf(
                    "input" to input,
                    "canonical" to canonical,
                    "variantsCount" to variants.size,
                    "dbPath" to dbPath,
                    "dbExists" to dbFile.exists(),
                ),
            )

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
                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "NATIVE_UNBLOCK",
                    msg = "EXIT empty phone",
                )
                promise.resolve(out)
                return
            }

            if (!dbFile.exists()) {
                out.putString("error", "db not found")
                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "NATIVE_UNBLOCK",
                    msg = "EXIT db not found",
                    data = mapOf("dbPath" to dbPath),
                )
                promise.resolve(out)
                return
            }

            val db = openDb() ?: run {
                out.putString("error", "db open failed")
                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "NATIVE_UNBLOCK",
                    msg = "EXIT db open failed",
                    data = mapOf("dbPath" to dbPath),
                )
                promise.resolve(out)
                return
            }

            val cols = readTableColumns(db, table)
            val phoneCol = pickPhoneColumn(cols)
            val hasLocalBlocked = cols.contains("local_blocked")

            if (phoneCol.isNullOrBlank() || !hasLocalBlocked) {
                out.putString("error", "required columns missing")
                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "NATIVE_UNBLOCK",
                    msg = "EXIT required columns missing",
                    data = mapOf(
                        "phoneCol" to (phoneCol ?: ""),
                        "hasLocalBlocked" to hasLocalBlocked,
                    ),
                )
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
                val sql = "UPDATE $table SET local_blocked = -1, server_updated_at = datetime('now') WHERE $phoneCol IN ($placeholders)"
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

                DiagnosticsStore.record(
                    context = reactContext,
                    topic = "NATIVE_UNBLOCK",
                    msg = "OK",
                    data = mapOf(
                        "canonical" to canonical,
                        "updated" to updated,
                        "matchedCount" to matchList.size,
                    ),
                )

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
            DiagnosticsStore.record(
                context = reactContext,
                topic = "NATIVE_UNBLOCK",
                msg = "ERROR ${e.message ?: "unknown"}",
            )
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
            val dbPath = try { getDbFile().absolutePath } catch (_: Exception) { null }
            logDbDiag("syncBlockedNumbers ENTER", "size=${numbers.size()} dbPath=$dbPath")
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
                    ensureCanonicalBlockedRow(db, raw ?: phone)
                }

                db.setTransactionSuccessful()
                recordLastWrite("syncBlockedNumbers", dbPath, numbers.size(), null, committed = true)
                if (BuildConfig.DEBUG) {
                    try {
                        val cur = db.rawQuery(
                            "SELECT COUNT(*) AS c, SUM(CASE WHEN local_blocked=1 THEN 1 ELSE 0 END) AS lc FROM scam_phones",
                            null
                        )
                        cur.use { c ->
                            if (c.moveToFirst()) {
                                val cAll = if (!c.isNull(0)) c.getInt(0) else 0
                                val cLocal = if (!c.isNull(1)) c.getInt(1) else 0
                                logDbDiag("syncBlockedNumbers AFTER_WRITE", "count=$cAll local=$cLocal")
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                promise.resolve(true)
            } finally {
                db.endTransaction()
                db.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[syncBlockedNumbers] ERROR", e)
            recordLastWrite(
                "syncBlockedNumbers",
                try { getDbFile().absolutePath } catch (_: Exception) { null },
                null,
                e.message ?: "unknown",
                committed = false
            )
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
            val dbPath = try { getDbFile().absolutePath } catch (_: Exception) { null }
            logDbDiag("syncSpamNumbers ENTER", "size=${items.size()} dbPath=$dbPath")
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
                recordLastWrite("syncSpamNumbers", dbPath, items.size(), null, committed = true)
                if (BuildConfig.DEBUG) {
                    try {
                        val cur = db.rawQuery(
                            "SELECT COUNT(*) AS c, SUM(CASE WHEN server_deleted=0 THEN 1 ELSE 0 END) AS alive FROM scam_phones",
                            null
                        )
                        cur.use { c ->
                            if (c.moveToFirst()) {
                                val cAll = if (!c.isNull(0)) c.getInt(0) else 0
                                val cAlive = if (!c.isNull(1)) c.getInt(1) else 0
                                logDbDiag("syncSpamNumbers AFTER_WRITE", "count=$cAll alive=$cAlive")
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                promise.resolve(true)
            } finally {
                db.endTransaction()
                db.close()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[syncSpamNumbers] ERROR", e)
            recordLastWrite(
                "syncSpamNumbers",
                try { getDbFile().absolutePath } catch (_: Exception) { null },
                null,
                e.message ?: "unknown",
                committed = false
            )
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
