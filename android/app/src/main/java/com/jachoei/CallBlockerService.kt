// android/app/src/main/java/com/myapp/CallBlockerService.kt
package com.jachoei

import android.telecom.Call
import android.telecom.CallScreeningService
import android.database.sqlite.SQLiteDatabase
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import android.util.Log

class CallBlockerService : CallScreeningService() {

    companion object {
        private const val TAG = "JACHOEI_CALL"
        private const val TRACE_TAG = "CALL_SCREEN_SERVICE"
        private const val DB_NAME = "scam-protect.db"
        private const val DB_TABLE = "scam_phones"
        private const val SPAM_WARN_RISK_THRESHOLD = 60  // risk >= 60 => warn-only (community)
        private const val NOTI_CHANNEL_ID = "jachoei_spam_calls"
        private const val LOCAL_BLOCK_CHANNEL_ID = "jachoei_local_block"
        private const val FORCE_TEST_NUMBER = "09232342434"

        // Verbose DB debug is debug-build only.
        private val DEBUG_DB_VERBOSE: Boolean = BuildConfig.DEBUG

        // Best-effort dedup to avoid spamming notifications for the same call action.
        @Volatile private var lastLocalBlockNotiPhone: String? = null
        @Volatile private var lastLocalBlockNotiAtMs: Long = 0
    }

    private fun ck(name: String, details: String? = null) {
        val d = details?.trim().orEmpty()
        if (d.isEmpty()) Log.i(TAG, name) else Log.i(TAG, "$name $d")
    }

    private fun safeJoin(values: Array<String>, max: Int = 12): String {
        if (values.isEmpty()) return ""
        val limited = if (values.size <= max) values else values.copyOfRange(0, max)
        val suffix = if (values.size > max) "...(+${values.size - max})" else ""
        return limited.joinToString(",") + suffix
    }

    private fun extractRawNumber(callDetails: Call.Details): String {
        val handle = callDetails.handle?.schemeSpecificPart
        if (!handle.isNullOrBlank()) return handle
        val gw = callDetails.gatewayInfo?.originalAddress?.schemeSpecificPart
        if (!gw.isNullOrBlank()) return gw
        return ""
    }

    private fun ensureLocalBlockNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = nm.getNotificationChannel(LOCAL_BLOCK_CHANNEL_ID)
        if (existing != null) return

        val ch = NotificationChannel(
            LOCAL_BLOCK_CHANNEL_ID,
            "Local block confirmations",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        nm.createNotificationChannel(ch)
    }

    private fun showLocalBlockNotification(phone: String) {
        val trimmed = phone.trim()
        if (trimmed.isEmpty()) return

        try {
            val now = System.currentTimeMillis()
            if (trimmed == lastLocalBlockNotiPhone && (now - lastLocalBlockNotiAtMs) < 2_000) {
                Log.d(TRACE_TAG, "showLocalBlockNotification() dedup -> skip")
                return
            }
            lastLocalBlockNotiPhone = trimmed
            lastLocalBlockNotiAtMs = now

            Log.d(TRACE_TAG, "showLocalBlockNotification() ENTER phone=$trimmed")
            CallBlockerModule.emitCallDebug(
                source = "BLOCK_DECISION",
                msg = "local block -> showLocalBlockNotification ENTER",
                normalizedNumber = trimmed,
                action = "LOCAL_BLOCK_NOTIFICATION_ENTER",
            )

            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            ensureLocalBlockNotificationChannel()

            val n = NotificationCompat.Builder(this, LOCAL_BLOCK_CHANNEL_ID)
                .setSmallIcon(applicationInfo.icon)
                .setContentTitle("Blocked number")
                .setContentText("$trimmed has been blocked")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .build()

            val id = ("local_block:" + trimmed).hashCode()
            nm.notify(kotlin.math.abs(id), n)

            Log.d(TRACE_TAG, "showLocalBlockNotification() POSTED")
            CallBlockerModule.emitCallDebug(
                source = "BLOCK_DECISION",
                msg = "local block -> notification posted",
                normalizedNumber = trimmed,
                action = "LOCAL_BLOCK_NOTIFICATION_SHOWN",
            )
        } catch (e: Exception) {
            Log.w(TAG, "showLocalBlockNotification failed", e)
            Log.d(TRACE_TAG, "showLocalBlockNotification() ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug(
                source = "BLOCK_DECISION",
                msg = "local block -> notification ERROR: ${e.message}",
                normalizedNumber = trimmed,
                action = "LOCAL_BLOCK_NOTIFICATION_ERROR",
            )
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TRACE_TAG, "onCreate")
        DiagnosticsStore.record(
            context = this,
            topic = "CALL_SERVICE",
            msg = "onCreate",
            data = mapOf(
                "pkg" to packageName,
                "sdk" to android.os.Build.VERSION.SDK_INT,
            ),
        )
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onCreate",
            action = "SERVICE_CREATE",
        )
    }

    override fun onBind(intent: Intent): IBinder? {
        Log.d(TRACE_TAG, "onBind action=${intent.action}")
        DiagnosticsStore.record(
            context = this,
            topic = "CALL_SERVICE",
            msg = "onBind action=${intent.action}",
            data = mapOf("action" to (intent.action ?: "")),
        )
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onBind action=${intent.action}",
            action = "SERVICE_BIND",
        )
        return super.onBind(intent)
    }

    override fun onDestroy() {
        Log.d(TRACE_TAG, "onDestroy")
        DiagnosticsStore.record(
            context = this,
            topic = "CALL_SERVICE",
            msg = "onDestroy",
        )
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onDestroy",
            action = "SERVICE_DESTROY",
        )
        super.onDestroy()
    }

    private fun ensureScamPhonesSchema(db: SQLiteDatabase) {
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

    override fun onScreenCall(callDetails: Call.Details) {
        val t0 = SystemClock.elapsedRealtime()
        try {
            ck(
                "CALL_SCREEN_START",
                "sdk=${android.os.Build.VERSION.SDK_INT} dir=${callDetails.callDirection} handle=${callDetails.handle}"
            )

            Log.d(TRACE_TAG, "onScreenCall ENTER")
            CallBlockerModule.emitCallDebug(
                source = "CALL_SCREEN_SERVICE",
                msg = "onScreenCall ENTER",
                action = "ENTER",
            )

            val number = extractRawNumber(callDetails)
            ck("CALL_SCREEN_NUMBER_RAW", "raw='$number'")
            Log.d(TRACE_TAG, "Incoming number: $number")

            val digits = PhoneUtils.digitsOnly(number)
            val canonical = PhoneUtils.normalize(number)
            val variants = PhoneUtils.variantsFromRaw(number)
            ck(
                "CALL_SCREEN_NUMBER_NORMALIZED",
                "digits='$digits' canonical='$canonical' variants=${safeJoin(variants)}"
            )

            val dbFile = getDatabasePath(DB_NAME)
            ck(
                "CALL_SCREEN_DB_PATH",
                "db=$DB_NAME path=${dbFile.absolutePath} exists=${dbFile.exists()} size=${dbFile.length()}"
            )

            if (canonical.isEmpty()) {
                ck("CALL_SCREEN_DECISION", "ALLOW reason=empty_or_private")
                ck("CALL_SCREEN_RESPONSE_ALLOW", "disallow=false")
                respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
                return
            }

            val status = lookupStatus(canonical, variants)
            ck(
                "CALL_SCREEN_LOOKUP_RESULT",
                "rowsFound=${status.rowsFound} matched=${status.matchedPhoneNormalized ?: ""} local_blocked=${status.localBlockedRaw} risk=${status.riskLevel} deleted=${status.serverDeletedRaw}"
            )
            if (status.rowsFound > 0) {
                ck(
                    "CALL_SCREEN_MATCHED_ROW",
                    "phone_normalized=${status.matchedPhoneNormalized} local_blocked=${status.localBlockedRaw} risk_level=${status.riskLevel} server_deleted=${status.serverDeletedRaw}"
                )
            }

            // FORCE TEST MODE (debug-only)
            if (BuildConfig.DEBUG) {
                val rawDigits = PhoneUtils.digitsOnly(number)
                if (rawDigits == FORCE_TEST_NUMBER) {
                    Log.d(TRACE_TAG, "FORCE TEST -> trigger warning notification + RN event")
                    showSpamWarningNotification(canonical, 99)
                    CallBlockerModule.emitIncomingSpamCall(canonical, 99, number)
                }
            }

            when {
                status.localBlocked -> {
                    ck("CALL_SCREEN_DECISION", "BLOCK reason=local_blocked")
                    CallBlockerModule.emitCallDebug(
                        source = "BLOCK_DECISION",
                        msg = "SELF_BLOCK -> REJECT",
                        rawNumber = number,
                        normalizedNumber = canonical,
                        matchedBlocked = true,
                        matchedSpam = false,
                        action = "REJECT_CALL",
                    )
                    Log.d(TAG, "[CALL] action=blocked_call source=self phone=$canonical")

                    showLocalBlockNotification(canonical)

                    BlockLogUtils.logEvent(
                        context = this,
                        phone = canonical,
                        rawPhone = number,
                        type = "call",
                        source = "self",
                        action = "blocked_call",
                        matchedBy = "local_db",
                        riskLevel = status.riskLevel,
                        note = "Call blocked by CallScreeningService"
                    )

                    val response = CallResponse.Builder()
                        .setDisallowCall(true)
                        .setRejectCall(true)
                        .setSkipCallLog(true)
                        .setSkipNotification(true)
                        .build()

                    ck(
                        "CALL_SCREEN_RESPONSE_BLOCK",
                        "disallow=true reject=true skipLog=true skipNoti=true"
                    )
                    respondToCall(callDetails, response)
                }

                status.isCommunitySpam -> {
                    ck("CALL_SCREEN_DECISION", "ALLOW reason=community_spam_warn_only risk=${status.riskLevel}")
                    CallBlockerModule.emitCallDebug(
                        source = "BLOCK_DECISION",
                        msg = "COMMUNITY_SPAM -> WARN_ONLY",
                        rawNumber = number,
                        normalizedNumber = canonical,
                        matchedBlocked = false,
                        matchedSpam = true,
                        action = "WARN_ONLY",
                    )
                    Log.d(TAG, "[CALL] action=spam_warning source=community phone=$canonical risk=${status.riskLevel}")

                    BlockLogUtils.logEvent(
                        context = this,
                        phone = canonical,
                        rawPhone = number,
                        type = "call",
                        source = "community",
                        action = "spam_warning",
                        matchedBy = "local_db",
                        riskLevel = status.riskLevel,
                        note = "Spam warning (call allowed)"
                    )

                    showSpamWarningNotification(canonical, status.riskLevel)
                    CallBlockerModule.emitIncomingSpamCall(canonical, status.riskLevel, number)

                    ck("CALL_SCREEN_RESPONSE_ALLOW", "disallow=false")
                    respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
                }

                else -> {
                    ck("CALL_SCREEN_DECISION", "ALLOW reason=no_match")
                    ck("CALL_SCREEN_RESPONSE_ALLOW", "disallow=false")
                    respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
                }
            }
        } catch (e: Exception) {
            ck("CALL_SCREEN_ERROR", "${e.message ?: "unknown"}")
            Log.e(TAG, "onScreenCall ERROR", e)
            // Fail-safe: do not crash the screening binder path.
            try {
                respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
            } catch (_: Exception) {
                // ignore
            }
        } finally {
            val dt = (SystemClock.elapsedRealtime() - t0)
            Log.d(TRACE_TAG, "onScreenCall END dtMs=$dt")
            CallBlockerModule.emitCallDebug(
                source = "CALL_SCREEN_SERVICE",
                msg = "onScreenCall END dtMs=$dt",
                action = "EXIT",
            )
        }
    }

    private data class ScamPhoneStatus(
        val localBlocked: Boolean,
        val isCommunitySpam: Boolean,
        val riskLevel: Int,
        val rowsFound: Int,
        val matchedPhoneNormalized: String?,
        val localBlockedRaw: Int,
        val serverDeletedRaw: Int,
    )

    private fun openDbReadOnly(): SQLiteDatabase? {
        return try {
            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "DB open START",
                dbName = DB_NAME,
                table = DB_TABLE,
                action = "DB_OPEN_START",
            )
            val dbFile = getDatabasePath(DB_NAME)
            val existed = dbFile.exists()
            Log.d(TRACE_TAG, "DB present=${dbFile.exists()} size=${dbFile.length()} pkg=$packageName path=${dbFile.absolutePath}")
            DiagnosticsStore.record(
                context = this,
                topic = "DB",
                msg = "openDb present=${dbFile.exists()} size=${dbFile.length()}",
                data = mapOf(
                    "db" to DB_NAME,
                    "path" to dbFile.absolutePath,
                    "exists" to dbFile.exists(),
                    "size" to dbFile.length(),
                ),
            )
            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "openDbReadOnly present=${dbFile.exists()} size=${dbFile.length()} pkg=$packageName path=${dbFile.absolutePath}",
                dbName = DB_NAME,
                dbPath = dbFile.absolutePath,
                table = DB_TABLE,
                action = "OPEN_DB_READONLY",
            )

            // Keep screening-time disk I/O minimal.
            // If DB is missing (fresh install / not yet initialized), create schema best-effort.
            val flags = if (existed) {
                SQLiteDatabase.OPEN_READONLY
            } else {
                SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
            }
            val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, flags)
            if (!existed) {
                try {
                    ensureScamPhonesSchema(db)
                } catch (_: Exception) {
                    // best-effort only
                }
            }

            // Debug-only: log table count.
            if (DEBUG_DB_VERBOSE) {
                try {
                    val cur = db.rawQuery("SELECT COUNT(*) AS c FROM $DB_TABLE", null)
                    cur.use { c ->
                        if (c.moveToFirst() && !c.isNull(0)) {
                            val n = c.getInt(0)
                            Log.d(TRACE_TAG, "DB $DB_TABLE count=$n")
                            CallBlockerModule.emitCallDebug(
                                source = "DB_LOOKUP",
                                msg = "DB count $DB_TABLE=$n",
                                dbName = DB_NAME,
                                dbPath = dbFile.absolutePath,
                                table = DB_TABLE,
                                action = "DB_COUNT",
                                rowsFound = n,
                            )
                        }
                    }
                } catch (_: Exception) {
                    // ignore
                }
            }

            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "DB open OK",
                dbName = DB_NAME,
                dbPath = dbFile.absolutePath,
                table = DB_TABLE,
                action = "DB_OPEN_OK",
            )
            db
        } catch (_: Exception) {
            Log.d(TRACE_TAG, "openDbReadOnly() failed")
            DiagnosticsStore.record(
                context = this,
                topic = "DB",
                msg = "openDb failed",
                data = mapOf("db" to DB_NAME),
            )
            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "DB open ERROR",
                dbName = DB_NAME,
                table = DB_TABLE,
                action = "OPEN_DB_READONLY_ERROR",
            )
            null
        }
    }

    private fun lookupStatus(phoneCanonical: String, variants: Array<String>): ScamPhoneStatus {
        val t0 = SystemClock.elapsedRealtime()

        Log.d(TRACE_TAG, "Variants(count=${variants.size}): ${if (DEBUG_DB_VERBOSE) variants.joinToString(",") else "(hidden)"}")
        CallBlockerModule.emitCallDebug(
            source = "DB_LOOKUP",
            msg = if (DEBUG_DB_VERBOSE) "variants generated" else "variants generated (count=${variants.size})",
            normalizedNumber = phoneCanonical,
            variants = if (DEBUG_DB_VERBOSE) variants.toList() else null,
            action = "VARIANTS",
        )

        try {
            val db = openDbReadOnly() ?: run {
                val dt = (SystemClock.elapsedRealtime() - t0).toDouble()
                CallBlockerModule.emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "DB missing/unavailable -> no match",
                    normalizedNumber = phoneCanonical,
                    matchedBlocked = false,
                    matchedSpam = false,
                    dbName = DB_NAME,
                    table = DB_TABLE,
                    rowsFound = 0,
                    finalDecision = "NO_MATCH",
                    lookupDurationMs = dt,
                    action = "DB_MISSING",
                )
                return ScamPhoneStatus(false, false, 0, 0, null, 0, 0)
            }

            // Keep screening-time work minimal; only run extra counts in verbose debug.
            if (DEBUG_DB_VERBOSE) {
                try {
                    val countCursor = db.rawQuery(
                        """
                        SELECT COUNT(*) AS c
                        FROM scam_phones
                        WHERE server_deleted = 0 AND risk_level >= ?
                        """.trimIndent(),
                        arrayOf(SPAM_WARN_RISK_THRESHOLD.toString())
                    )
                    countCursor.use { cc ->
                        if (cc.moveToFirst()) {
                            Log.d(TRACE_TAG, "Spam list size (risk>=${SPAM_WARN_RISK_THRESHOLD}): ${cc.getInt(0)}")
                        }
                    }
                } catch (_: Exception) {
                    Log.d(TRACE_TAG, "Spam list count query failed")
                }
            }

            val placeholders = variants.joinToString(",") { "?" }
            val sql = """
                SELECT phone_normalized, risk_level, server_deleted, local_blocked
                FROM $DB_TABLE
                WHERE phone_normalized IN ($placeholders)
                ORDER BY local_blocked DESC, risk_level DESC
                LIMIT 1
                """.trimIndent()

            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "SQL query EXEC",
                normalizedNumber = phoneCanonical,
                dbName = DB_NAME,
                dbPath = try { getDatabasePath(DB_NAME).absolutePath } catch (_: Exception) { null },
                table = DB_TABLE,
                query = if (DEBUG_DB_VERBOSE) sql else null,
                queryArgs = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                variants = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                action = "DB_QUERY_EXEC",
            )
            val cursor = db.rawQuery(
                sql,
                variants
            )

            cursor.use { c ->
                if (!c.moveToFirst()) {
                    db.close()
                    val dt = (SystemClock.elapsedRealtime() - t0).toDouble()
                    CallBlockerModule.emitCallDebug(
                        source = "DB_LOOKUP",
                        msg = "no match found in scam_phones",
                        normalizedNumber = phoneCanonical,
                        matchedBlocked = false,
                        matchedSpam = false,
                        dbName = DB_NAME,
                        dbPath = try { getDatabasePath(DB_NAME).absolutePath } catch (_: Exception) { null },
                        table = DB_TABLE,
                        query = if (DEBUG_DB_VERBOSE) sql else null,
                        queryArgs = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                        variants = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                        rowsFound = 0,
                        finalDecision = "NO_MATCH",
                        lookupDurationMs = dt,
                        action = "NO_MATCH",
                    )
                    return ScamPhoneStatus(false, false, 0, 0, null, 0, 0)
                }

                val matchedPhone = c.getString(c.getColumnIndexOrThrow("phone_normalized"))
                val risk = c.getInt(c.getColumnIndexOrThrow("risk_level"))
                val deleted = c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                val local = c.getInt(c.getColumnIndexOrThrow("local_blocked"))
                db.close()

                Log.d(TRACE_TAG, "DB row: risk=$risk deleted=$deleted local=$local")

                val localBlocked = local == 1
                val communitySpam = !localBlocked && deleted == 0 && risk >= SPAM_WARN_RISK_THRESHOLD
                val dt = (SystemClock.elapsedRealtime() - t0).toDouble()
                CallBlockerModule.emitCallDebug(
                    source = "DB_LOOKUP",
                    msg = "db row risk=$risk deleted=$deleted local=$local threshold=$SPAM_WARN_RISK_THRESHOLD",
                    normalizedNumber = phoneCanonical,
                    matchedBlocked = localBlocked,
                    matchedSpam = communitySpam,
                    dbName = DB_NAME,
                    dbPath = try { getDatabasePath(DB_NAME).absolutePath } catch (_: Exception) { null },
                    table = DB_TABLE,
                    query = if (DEBUG_DB_VERBOSE) sql else null,
                    queryArgs = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                    variants = if (DEBUG_DB_VERBOSE) variants.toList() else null,
                    rowsFound = 1,
                    matchedRow = if (DEBUG_DB_VERBOSE) {
                        mapOf(
                            "phone_normalized" to matchedPhone,
                            "risk_level" to risk,
                            "server_deleted" to deleted,
                            "local_blocked" to local,
                            "phone_canonical" to phoneCanonical,
                        )
                    } else {
                        null
                    },
                    riskLevel = risk,
                    localBlocked = localBlocked,
                    serverDeleted = deleted == 1,
                    finalDecision = when {
                        localBlocked -> "BLOCK"
                        communitySpam -> "WARN"
                        else -> "ALLOW"
                    },
                    lookupDurationMs = dt,
                    action = "DB_ROW",
                )
                return ScamPhoneStatus(localBlocked, communitySpam, risk, 1, matchedPhone, local, deleted)
            }
        } catch (e: Exception) {
            Log.e(TAG, "lookupStatus error", e)
            Log.d(TRACE_TAG, "lookupStatus() ERROR: ${e.message}")
            val dt = (SystemClock.elapsedRealtime() - t0).toDouble()
            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "lookupStatus ERROR: ${e.message}",
                normalizedNumber = phoneCanonical,
                dbName = DB_NAME,
                table = DB_TABLE,
                finalDecision = "ERROR_FALLBACK_ALLOW",
                lookupDurationMs = dt,
                action = "LOOKUP_ERROR",
            )
            return ScamPhoneStatus(false, false, 0, 0, null, 0, 0)
        }
    }

    private fun showSpamWarningNotification(phone: String, risk: Int) {
        try {
            Log.d(TRACE_TAG, "showSpamWarningNotification() phone=$phone risk=$risk")
            CallBlockerModule.emitCallDebug(
                source = "SPAM_WARNING_TRIGGER",
                msg = "showSpamWarningNotification",
                normalizedNumber = phone,
                matchedSpam = true,
                action = "SHOW_WARNING_NOTIFICATION",
            )
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Create channel (no-op on < 26)
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                val ch = NotificationChannel(
                    NOTI_CHANNEL_ID,
                    "Spam call warnings",
                    NotificationManager.IMPORTANCE_HIGH
                )
                nm.createNotificationChannel(ch)
            }

            val title = "Suspected spam caller"
            val text = if (risk > 0) "Phone: $phone (risk $risk)" else "Phone: $phone"

            val n = NotificationCompat.Builder(this, NOTI_CHANNEL_ID)
                .setSmallIcon(applicationInfo.icon)
                .setContentTitle(title)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .build()

            nm.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n)
            Log.d(TRACE_TAG, "Notification posted")
            CallBlockerModule.emitCallDebug(
                source = "SPAM_WARNING_TRIGGER",
                msg = "Notification posted",
                normalizedNumber = phone,
                matchedSpam = true,
                action = "WARNING_NOTIFICATION_POSTED",
            )
        } catch (e: Exception) {
            // best-effort only
            Log.w(TAG, "showSpamWarningNotification failed", e)
            Log.d(TRACE_TAG, "Notification failed: ${e.message}")
            CallBlockerModule.emitCallDebug(
                source = "SPAM_WARNING_TRIGGER",
                msg = "Notification failed: ${e.message}",
                normalizedNumber = phone,
                matchedSpam = true,
                action = "WARNING_NOTIFICATION_ERROR",
            )
        }
    }
}