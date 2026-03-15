// android/app/src/main/java/com/myapp/CallBlockerService.kt
package com.jachoei

import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import android.database.sqlite.SQLiteDatabase

class CallBlockerService : CallScreeningService() {

    companion object {
        private const val TAG = "CallBlockerService"
        private const val DB_NAME = "scam-protect.db"
        private const val BLOCK_RISK_THRESHOLD = 60  // risk >= 60 auto block
    }

    override fun onScreenCall(callDetails: Call.Details) {
        val handle = callDetails.handle
        val number = handle?.schemeSpecificPart ?: ""

        Log.d(TAG, "Incoming call: raw number=$number")

        val normalized = normalizePhone(number)
        Log.d(TAG, "Normalized number=$normalized")

        val shouldBlock = isBlockedByDb(normalized)

        if (shouldBlock) {
            Log.d(TAG, "Blocking call from $normalized")

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
            Log.d(TAG, "Allow call from $normalized")

            val response = CallResponse.Builder()
                .setDisallowCall(false)
                .build()

            respondToCall(callDetails, response)
        }
    }

    private fun openDb(): SQLiteDatabase? {
        val dbFile = getDatabasePath(DB_NAME)
        Log.d(TAG, "DB path = ${dbFile.absolutePath}")
        if (!dbFile.exists()) {
            Log.w(TAG, "DB file not found")
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
                    Log.d(TAG, "Number not found in db: $phone")
                    db.close()
                    return false
                }

                val riskLevel =
                    c.getInt(c.getColumnIndexOrThrow("risk_level"))
                val serverDeleted =
                    c.getInt(c.getColumnIndexOrThrow("server_deleted"))
                val localBlocked =
                    c.getInt(c.getColumnIndexOrThrow("local_blocked"))

                Log.d(
                    TAG,
                    "DB result for $phone: risk=$riskLevel, deleted=$serverDeleted, local_blocked=$localBlocked"
                )

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