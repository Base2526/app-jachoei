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
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onCreate",
            action = "SERVICE_CREATE",
        )
    }

    override fun onBind(intent: Intent): IBinder? {
        Log.d(TRACE_TAG, "onBind action=${intent.action}")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onBind action=${intent.action}",
            action = "SERVICE_BIND",
        )
        return super.onBind(intent)
    }

    override fun onDestroy() {
        Log.d(TRACE_TAG, "onDestroy")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onDestroy",
            action = "SERVICE_DESTROY",
        )
        super.onDestroy()
    }

    // STEP 2 requirement: normalize +66 -> 0 and strip formatting
    private fun normalizePhoneNumber(input: String?): String {
        if (input.isNullOrBlank()) return ""
        val raw = input.trim()
        val hasPlus = raw.startsWith("+")
        val digits = raw.replace(Regex("[^\\d]"), "")
        if (digits.isEmpty()) return ""

        // Convert +66xxxxxxxxx or 66xxxxxxxxx -> 0xxxxxxxxx (Thai)
        if ((hasPlus && raw.startsWith("+66")) || (digits.startsWith("66") && digits.length == 11)) {
            return "0" + digits.substring(2)
        }

        // Keep 0xxxxxxxxx as-is
        return digits
    }

    override fun onScreenCall(callDetails: Call.Details) {
        Log.d(TRACE_TAG, "onScreenCall ENTER")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "onScreenCall ENTER",
            action = "ENTER",
        )
        val handle = callDetails.handle
        val number = handle?.schemeSpecificPart ?: ""
        Log.d(TRACE_TAG, "Incoming number: $number")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "INCOMING_CALL detected path=CallScreeningService",
            rawNumber = number,
            action = "INCOMING_CALL_DETECTED",
        )

        val normalizedLocal = normalizePhoneNumber(number)
        Log.d(TRACE_TAG, "Normalized: $normalizedLocal")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "NORMALIZATION local",
            rawNumber = number,
            normalizedNumber = normalizedLocal,
            action = "NORMALIZE_LOCAL",
        )

        // Canonical key for DB matching (digits-only, 0xxxxxxxxx -> 66xxxxxxxxx)
        val normalized = PhoneUtils.normalize(normalizedLocal)
        Log.d(TRACE_TAG, "Canonical: $normalized")
        CallBlockerModule.emitCallDebug(
            source = "CALL_SCREEN_SERVICE",
            msg = "NORMALIZATION canonical",
            rawNumber = number,
            normalizedNumber = normalized,
            action = "NORMALIZE_CANONICAL",
        )

        if (normalized.isEmpty()) {
            Log.d(TRACE_TAG, "Empty/unknown number -> ALLOW")
            CallBlockerModule.emitCallDebug(
                source = "BLOCK_DECISION",
                msg = "Empty/unknown number -> ALLOW",
                rawNumber = number,
                normalizedNumber = normalized,
                matchedBlocked = false,
                matchedSpam = false,
                action = "ALLOW",
            )
            // Unknown/private number -> allow normal
            respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
            return
        }

        val status = lookupStatus(normalized)
        Log.d(TRACE_TAG, "MatchResult localBlocked=${status.localBlocked} communitySpam=${status.isCommunitySpam} risk=${status.riskLevel}")
        CallBlockerModule.emitCallDebug(
            source = "DB_LOOKUP",
            msg = "MATCH_RESULT risk=${status.riskLevel}",
            rawNumber = number,
            normalizedNumber = normalized,
            matchedBlocked = status.localBlocked,
            matchedSpam = status.isCommunitySpam,
            action = "MATCH_RESULT",
        )

        // STEP 4: FORCE TEST MODE (debug-only)
        if (BuildConfig.DEBUG) {
            val rawDigits = normalizePhoneNumber(number)
            if (rawDigits == FORCE_TEST_NUMBER) {
                Log.d(TRACE_TAG, "FORCE TEST spam warning for number=$rawDigits")
                Log.d(TRACE_TAG, "FORCE TEST -> trigger warning notification + RN event")
                CallBlockerModule.emitCallDebug(
                    source = "SPAM_WARNING_TRIGGER",
                    msg = "FORCE_TEST warning path=CallScreeningService",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedSpam = true,
                    action = "FORCE_TEST_WARNING",
                )
                showSpamWarningNotification(normalized, 99)
                CallBlockerModule.emitIncomingSpamCall(normalized, 99, number)
            }
        }

        when {
            status.localBlocked -> {
                Log.d(TRACE_TAG, "Decision: SELF_BLOCK -> REJECT")
                CallBlockerModule.emitCallDebug(
                    source = "BLOCK_DECISION",
                    msg = "SELF_BLOCK -> REJECT",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedBlocked = true,
                    matchedSpam = false,
                    action = "REJECT_CALL",
                )
                Log.d(TAG, "[CALL] action=blocked_call source=self phone=$normalized")

                // Custom app notification (system call UI remains suppressed below).
                Log.d(TRACE_TAG, "Local block -> about to show app notification")
                showLocalBlockNotification(normalized)

                BlockLogUtils.logEvent(
                    context = this,
                    phone = normalized,
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
                CallBlockerModule.emitCallDebug(
                    source = "BLOCK_DECISION",
                    msg = "respondToCall(disallow=true reject=true skipLog=true skipNoti=true)",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedBlocked = true,
                    matchedSpam = false,
                    action = "RESPOND_REJECT",
                )
                respondToCall(callDetails, response)
            }

            status.isCommunitySpam -> {
                Log.d(TRACE_TAG, "Decision: COMMUNITY_SPAM -> WARN_ONLY")
                CallBlockerModule.emitCallDebug(
                    source = "BLOCK_DECISION",
                    msg = "COMMUNITY_SPAM -> WARN_ONLY",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedBlocked = false,
                    matchedSpam = true,
                    action = "WARN_ONLY",
                )
                Log.d(TAG, "[CALL] action=spam_warning source=community phone=$normalized risk=${status.riskLevel}")
                Log.d(TRACE_TAG, "Matched: true")
                CallBlockerModule.emitCallDebug(
                    source = "SPAM_WARNING_TRIGGER",
                    msg = "spam matched -> trigger warning",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedSpam = true,
                    action = "TRIGGER_WARNING",
                )

                BlockLogUtils.logEvent(
                    context = this,
                    phone = normalized,
                    rawPhone = number,
                    type = "call",
                    source = "community",
                    action = "spam_warning",
                    matchedBy = "local_db",
                    riskLevel = status.riskLevel,
                    note = "Spam warning (call allowed)"
                )

                showSpamWarningNotification(normalized, status.riskLevel)
                CallBlockerModule.emitIncomingSpamCall(normalized, status.riskLevel, number)
                Log.d(TRACE_TAG, "Warning triggered (notification + RN event)")
                CallBlockerModule.emitCallDebug(
                    source = "SPAM_WARNING_TRIGGER",
                    msg = "warning shown + RN event emitted",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedSpam = true,
                    action = "WARNING_SHOWN",
                )

                val response = CallResponse.Builder()
                    .setDisallowCall(false)
                    .build()
                CallBlockerModule.emitCallDebug(
                    source = "BLOCK_DECISION",
                    msg = "respondToCall(disallow=false)",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedBlocked = false,
                    matchedSpam = true,
                    action = "RESPOND_ALLOW",
                )
                respondToCall(callDetails, response)
            }

            else -> {
                Log.d(TRACE_TAG, "Matched: false")
                Log.d(TRACE_TAG, "Decision: ALLOW")
                CallBlockerModule.emitCallDebug(
                    source = "BLOCK_DECISION",
                    msg = "no match found -> ALLOW",
                    rawNumber = number,
                    normalizedNumber = normalized,
                    matchedBlocked = false,
                    matchedSpam = false,
                    action = "ALLOW",
                )
                respondToCall(callDetails, CallResponse.Builder().setDisallowCall(false).build())
            }
        }
    }

    private data class ScamPhoneStatus(
        val localBlocked: Boolean,
        val isCommunitySpam: Boolean,
        val riskLevel: Int,
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
            Log.d(TRACE_TAG, "DB present=${dbFile.exists()} path=${dbFile.absolutePath}")
            CallBlockerModule.emitCallDebug(
                source = "DB_LOOKUP",
                msg = "openDbReadOnly present=${dbFile.exists()} path=${dbFile.absolutePath}",
                dbName = DB_NAME,
                dbPath = dbFile.absolutePath,
                table = DB_TABLE,
                action = "OPEN_DB_READONLY",
            )
            if (!dbFile.exists()) return null
            val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
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

    private fun lookupStatus(phoneCanonical: String): ScamPhoneStatus {
        val t0 = SystemClock.elapsedRealtime()
        val variants = PhoneUtils.variants(phoneCanonical)

        Log.d(TRACE_TAG, "Variants: ${variants.joinToString(",")}")
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
                return ScamPhoneStatus(false, false, 0)
            }

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

            val placeholders = variants.joinToString(",") { "?" }
            val sql = """
                SELECT risk_level, server_deleted, local_blocked
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
                    return ScamPhoneStatus(false, false, 0)
                }

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
                return ScamPhoneStatus(localBlocked, communitySpam, risk)
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
            return ScamPhoneStatus(false, false, 0)
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