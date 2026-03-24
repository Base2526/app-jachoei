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
        private const val TAG = "SmsBlocker"
        private const val DB_NAME = "scam-protect.db"
        private const val BLOCK_RISK_THRESHOLD = 60
    }

    override fun onReceive(context: Context, intent: Intent) {
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
                    val normalized = normalizePhone(sender)
                    if (normalized.isEmpty()) continue

                    val shouldFlag = isBlockedByDb(context, normalized)
                    if (shouldFlag) {
                        BlockLogUtils.logBlocked(
                            context = context,
                            phone = normalized,
                            rawPhone = sender,
                            type = "sms",
                            detail = "SMS flagged by SmsBlockerReceiver"
                        )

                        // NOTE: A non-default SMS app cannot reliably block/delete incoming SMS.
                        // We only detect and record the event here.
                        break
                    }
                }
            } catch (e: Exception) {
                if (BuildConfig.DEBUG) {
                    Log.e(TAG, "onReceive processing error", e)
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun normalizePhone(raw: String?): String {
        if (raw.isNullOrEmpty()) return ""
        var s = raw.replace(Regex("[^\\d+]"), "")
        if (s.startsWith("+")) return s
        if (s.startsWith("0") && s.length >= 9) {
            return "+66" + s.substring(1)
        }
        return s
    }

    private fun openDb(context: Context): SQLiteDatabase? {
        val dbFile = context.getDatabasePath(DB_NAME)
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "[openDb] present=${dbFile.exists()}")
        }
        if (!dbFile.exists()) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "[openDb] DB NOT FOUND")
            }
            return null
        }

        return SQLiteDatabase.openDatabase(
            dbFile.absolutePath,
            null,
            SQLiteDatabase.OPEN_READONLY
        )
    }

    private fun isBlockedByDb(context: Context, phone: String): Boolean {
        return try {
            val db = openDb(context) ?: return false

            val cursor = db.rawQuery(
                """
                SELECT risk_level, server_deleted, local_blocked
                FROM scam_phones
                WHERE phone_normalized = ?
                LIMIT 1
                """.trimIndent(),
                arrayOf(phone)
            )

            cursor.use { c ->
                if (!c.moveToFirst()) {
                    db.close()
                    return false
                }

                val risk = c.getInt(c.getColumnIndexOrThrow("risk_level"))
                val del = c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                val local = c.getInt(c.getColumnIndexOrThrow("local_blocked"))

                Log.d(TAG, "SMS check: risk=$risk deleted=$del local=$local")

                db.close()

                return (local == 1) || (del == 0 && risk >= BLOCK_RISK_THRESHOLD)
            }
        } catch (e: Exception) {
            Log.e(TAG, "isBlockedByDb error", e)
            false
        }
    }
}
