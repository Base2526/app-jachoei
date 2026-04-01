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
                    val normalized = PhoneUtils.normalize(sender)
                    Log.d(TRACE_TAG, "Canonical sender: $normalized")
                    CallBlockerModule.emitCallDebug("PHONE_RECEIVER SMS canonical=$normalized")
                    if (normalized.isEmpty()) continue

                    val status = lookupStatus(context, normalized)
                    Log.d(TRACE_TAG, "SMS MatchResult localBlocked=${status.localBlocked} communitySpam=${status.isCommunitySpam} risk=${status.riskLevel}")
                    CallBlockerModule.emitCallDebug(
                        "PHONE_RECEIVER SMS MatchResult localBlocked=${status.localBlocked} communitySpam=${status.isCommunitySpam} risk=${status.riskLevel}"
                    )
                    if (status.localBlocked) {
                        Log.d(TRACE_TAG, "SMS Decision: SELF_BLOCK (log only)")
                        BlockLogUtils.logEvent(
                            context = context,
                            phone = normalized,
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
                            phone = normalized,
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
        Log.d(TRACE_TAG, "SMS DB present=${dbFile.exists()} path=${dbFile.absolutePath}")
        if (!dbFile.exists()) {
            Log.d(TRACE_TAG, "SMS DB NOT FOUND")
            return null
        }

        return SQLiteDatabase.openDatabase(
            dbFile.absolutePath,
            null,
            SQLiteDatabase.OPEN_READONLY
        )
    }

    private data class ScamPhoneStatus(
        val localBlocked: Boolean,
        val isCommunitySpam: Boolean,
        val riskLevel: Int,
    )

    private fun lookupStatus(context: Context, phoneCanonical: String): ScamPhoneStatus {
        val variants = PhoneUtils.variants(phoneCanonical)
        Log.d(TRACE_TAG, "SMS Variants: ${variants.joinToString(",")}")

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
