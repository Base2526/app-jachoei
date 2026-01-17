package com.myapp

import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.*
import android.util.Log

class CallBlockerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "Blocker"   // 👈 ใช้ง่ายที่สุด
        private const val DB_NAME = "scam-protect.db"
    }

    override fun getName(): String = "CallBlocker"

    private fun normalizePhone(raw: String?): String {
        if (raw.isNullOrEmpty()) return ""

        // เก็บเฉพาะตัวเลขและ + (เหมือน JS: replace(/[^\d+]/g, ""))
        var s = raw.replace(Regex("[^\\d+]"), "")

        // ถ้ามี + อยู่แล้ว ปล่อยเลย
        if (s.startsWith("+")) return s

        // ถ้าเริ่มด้วย 0 และยาว >= 9 → แปลงเป็น +66...
        if (s.startsWith("0") && s.length >= 9) {
            return "+66" + s.substring(1)
        }

        // อย่างอื่น return ตามเดิม
        return s
    }

    /** เปิด DB scam-protect.db */
    private fun openDb(): SQLiteDatabase? {
        val dbFile = reactContext.getDatabasePath(DB_NAME)
        Log.d(TAG, "[openDb] path = ${dbFile.absolutePath}")

        if (!dbFile.exists()) {
            Log.w(TAG, "[openDb] DB NOT FOUND !!")
            return null
        }

        return SQLiteDatabase.openDatabase(
            dbFile.absolutePath,
            null,
            SQLiteDatabase.OPEN_READWRITE
        )
    }

    // ========================
    // Add Block Number
    // ========================
    @ReactMethod
    fun addBlockedNumber(phoneRaw: String, promise: Promise) {
        Log.d(TAG, "===== addBlockedNumber() =====")
        Log.d(TAG, "[input] raw = '$phoneRaw'")

        try {
            val phone = normalizePhone(phoneRaw)
            Log.d(TAG, "[normalize] phone = '$phone'")

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

                db.execSQL(
                    """
                    UPDATE scam_phones
                    SET local_blocked = 1
                    WHERE phone_normalized = ?
                    """.trimIndent(),
                    arrayOf(phone)
                )

                db.setTransactionSuccessful()
                Log.d(TAG, "[SUCCESS] '$phone' is now BLOCKED")
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
        Log.d(TAG, "===== removeBlockedNumber() =====")
        Log.d(TAG, "[input] raw = '$phoneRaw'")

        try {
            val phone = normalizePhone(phoneRaw)
            Log.d(TAG, "[normalize] phone = '$phone'")

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

                db.execSQL(
                    """
                    UPDATE scam_phones
                    SET local_blocked = 0
                    WHERE phone_normalized = ?
                    """.trimIndent(),
                    arrayOf(phone)
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
        Log.d(TAG, "===== listBlockedNumbers() =====")

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
}
