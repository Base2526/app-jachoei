// android/app/src/main/java/com/myapp/CallBlockerService.kt
package com.jachoei

import android.telecom.Call
import android.telecom.CallScreeningService
import android.database.sqlite.SQLiteDatabase
import android.util.Log

class CallBlockerService : CallScreeningService() {

    companion object {
        private const val TAG = "CallBlockerService"
        private const val DB_NAME = "scam-protect.db"
        private const val BLOCK_RISK_THRESHOLD = 60  // risk >= 60 auto block
    }

    override fun onScreenCall(callDetails: Call.Details) {
        val handle = callDetails.handle
        val number = handle?.schemeSpecificPart ?: ""
        val normalized = normalizePhone(number)
        val shouldBlock = isBlockedByDb(normalized)

        if (shouldBlock) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Blocking call (normalized)")
            }

            BlockLogUtils.logBlocked(
                context = this,
                phone = normalized,
                rawPhone = number,
                type = "call",
                detail = "Call blocked by CallScreeningService"
            )

            val response = CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(true)
                .setSkipNotification(true)
                .build()

            respondToCall(callDetails, response)
        } else {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Allow call")
            }

            val response = CallResponse.Builder()
                .setDisallowCall(false)
                .build()

            respondToCall(callDetails, response)
        }
    }

    private fun openDb(): SQLiteDatabase? {
        val dbFile = getDatabasePath(DB_NAME)
        if (!dbFile.exists()) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "DB file not found")
            }
            return null
        }
        return SQLiteDatabase.openDatabase(
            dbFile.absolutePath,
            null,
            SQLiteDatabase.OPEN_READONLY
        )
    }

    /**
     * ถ้า local_blocked = 1 → บล็อกทันที
     * หรือ risk_level >= BLOCK_RISK_THRESHOLD และ server_deleted = 0 → บล็อก
     */
    private fun isBlockedByDb(phone: String): Boolean {
        return try {
            val db = openDb() ?: return false

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

                val riskLevel =
                    c.getInt(c.getColumnIndexOrThrow("risk_level"))
                val serverDeleted =
                    c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                val localBlocked =
                    c.getInt(c.getColumnIndexOrThrow("local_blocked"))

                db.close()

                if (localBlocked == 1) {
                    return true
                }

                return serverDeleted == 0 && riskLevel >= BLOCK_RISK_THRESHOLD
            }
        } catch (e: Exception) {
            Log.e(TAG, "isBlockedByDb error", e)
            false
        }
    }

    private fun normalizePhone(raw: String): String {
        var p = raw.replace(" ", "").replace("-", "")
        if (p.startsWith("+66")) {
            p = "0" + p.removePrefix("+66")
        }
        return p
    }
}