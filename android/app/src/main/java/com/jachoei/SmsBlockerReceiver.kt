package com.jachoei

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import kotlin.concurrent.thread

class SmsBlockerReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "JACHOEI_CALL"
        private const val TRACE_TAG = "PHONE_RECEIVER"
        private const val DB_NAME = "scam-protect.db"
        private const val SPAM_WARN_RISK_THRESHOLD = 60
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TRACE_TAG, "SmsBlockerReceiver.onReceive() ENTER action=${intent.action}")
        DiagnosticsStore.record(
            context = context,
            topic = "SMS_RX",
            msg = "onReceive action=${intent.action}",
            data = mapOf(
                "action" to (intent.action ?: ""),
                "sdk" to android.os.Build.VERSION.SDK_INT,
            ),
        )
        CallBlockerModule.emitCallDebug("PHONE_RECEIVER onReceive action=${intent.action}")
        // Keep work lightweight in the broadcast path.
        // We do NOT abort/intercept SMS delivery and we do NOT read SMS history.
        val action = intent.action
        if (action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val pendingResult = goAsync()
        thread(name = "SmsBlockerReceiver") {
            try {
                // Only process incoming SMS from the broadcast intent.
                // Do NOT read or store message body content.
                val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                for (sms in msgs) {
                    val sender = sms.displayOriginatingAddress ?: ""
                    Log.d(TRACE_TAG, "Incoming SMS sender: $sender")
                    CallBlockerModule.emitCallDebug("PHONE_RECEIVER SMS sender raw=$sender")
                    val canonical = PhoneUtils.normalize(sender)
                    Log.d(TRACE_TAG, "Canonical sender: $canonical")
                    CallBlockerModule.emitCallDebug("PHONE_RECEIVER SMS canonical=$canonical")
                    if (canonical.isEmpty()) continue

                    val status = lookupStatus(context, sender, canonical)
                    Log.d(TRACE_TAG, "SMS MatchResult localBlocked=${status.localBlocked} communitySpam=${status.isCommunitySpam} risk=${status.riskLevel}")
                    CallBlockerModule.emitCallDebug(
                        "PHONE_RECEIVER SMS MatchResult localBlocked=${status.localBlocked} communitySpam=${status.isCommunitySpam} risk=${status.riskLevel}"
                    )
                    if (status.localBlocked) {
                        Log.d(TRACE_TAG, "SMS Decision: SELF_BLOCK (log only)")
                        BlockLogUtils.logEvent(
                            context = context,
                            phone = canonical,
                            rawPhone = sender,
                            type = "sms",
                            source = "self",
                            action = "blocked_call",
                            matchedBy = "local_db",
                            riskLevel = status.riskLevel,
                            note = "SMS detected (self-block)"
                        )

                        break
                    }

                    if (status.isCommunitySpam) {
                        Log.d(TRACE_TAG, "SMS Decision: COMMUNITY_SPAM warn-only (log only)")
                        BlockLogUtils.logEvent(
                            context = context,
                            phone = canonical,
                            rawPhone = sender,
                            type = "sms",
                            source = "community",
                            action = "spam_warning",
                            matchedBy = "local_db",
                            riskLevel = status.riskLevel,
                            note = "SMS detected (community warn-only)"
                        )
                        break
                    }
                }
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.e(TAG, "onReceive processing error", e)
                }
                Log.d(TRACE_TAG, "SmsBlockerReceiver ERROR: ${e.message}")
                CallBlockerModule.emitCallDebug("PHONE_RECEIVER ERROR: ${e.message}")
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun openDb(context: Context): SQLiteDatabase? {
        val dbFile = context.getDatabasePath(DB_NAME)
        Log.d(TRACE_TAG, "SMS DB present=${dbFile.exists()} size=${dbFile.length()} pkg=${context.packageName} path=${dbFile.absolutePath}")
        DiagnosticsStore.record(
            context = context,
            topic = "DB",
            msg = "sms openDb present=${dbFile.exists()} size=${dbFile.length()}",
            data = mapOf(
                "db" to DB_NAME,
                "path" to dbFile.absolutePath,
                "exists" to dbFile.exists(),
                "size" to dbFile.length(),
            ),
        )

        return try {
            val db = SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
            )

            // Ensure schema exists even if JS init hasn't run yet.
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

            db
        } catch (e: Exception) {
            Log.d(TRACE_TAG, "SMS openDb ERROR: ${e.message}")
            DiagnosticsStore.record(
                context = context,
                topic = "DB",
                msg = "sms openDb ERROR: ${e.message}",
                data = mapOf("db" to DB_NAME),
            )
            null
        }
    }

    private data class ScamPhoneStatus(
        val localBlocked: Boolean,
        val isCommunitySpam: Boolean,
        val riskLevel: Int,
    )

    private fun lookupStatus(context: Context, raw: String, phoneCanonical: String): ScamPhoneStatus {
        val variants = PhoneUtils.variantsFromRaw(raw)
        Log.d(TRACE_TAG, "SMS Variants(count=${variants.size}): ${variants.joinToString(",")}")

        return try {
            val db = openDb(context) ?: return ScamPhoneStatus(false, false, 0)
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

            cursor.use { c ->
                if (!c.moveToFirst()) {
                    db.close()
                    return ScamPhoneStatus(false, false, 0)
                }

                val risk = c.getInt(c.getColumnIndexOrThrow("risk_level"))
                val del = c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                val local = c.getInt(c.getColumnIndexOrThrow("local_blocked"))
                db.close()

                val localBlocked = local == 1
                val communitySpam = !localBlocked && del == 0 && risk >= SPAM_WARN_RISK_THRESHOLD
                ScamPhoneStatus(localBlocked, communitySpam, risk)
            }
        } catch (e: Exception) {
            Log.e(TAG, "lookupStatus error", e)
            Log.d(TRACE_TAG, "SMS lookupStatus ERROR: ${e.message}")
            ScamPhoneStatus(false, false, 0)
        }
    }
}
