package com.jachoei

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log

object BlockLogUtils {

    private const val TAG = "BlockLog"
    private const val DB_NAME = "scam-protect.db"

    private fun openDb(context: Context): SQLiteDatabase? {
        val file = context.getDatabasePath(DB_NAME)
        if (!file.exists()) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "[openDb] DB not found")
            }
            return null
        }
        return SQLiteDatabase.openDatabase(
            file.absolutePath,
            null,
            SQLiteDatabase.OPEN_READWRITE
        )
    }

    fun logBlocked(context: Context, phone: String, rawPhone: String?, type: String, detail: String? = null) {
        try {
            val db = openDb(context) ?: return
            db.execSQL(
                """
                INSERT INTO blocked_logs (phone_normalized, raw_phone, type, detail)
                VALUES (?,?,?,?)
                """.trimIndent(),
                arrayOf(phone, rawPhone, type, detail)
            )
            db.close()

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "[insert] type=$type")
            }

        } catch (e: Exception) {
            Log.e(TAG, "logBlocked error", e)
        }
    }
}
