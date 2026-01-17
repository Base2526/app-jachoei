package com.myapp

import android.content.Context
import android.net.Uri
import android.provider.Telephony
import android.util.Log

object SmsUtils {

    private const val TAG = "SmsBlockerUtils"

    fun deleteSmsByAddress(context: Context, address: String) {
        try {
            val uri = Telephony.Sms.Inbox.CONTENT_URI
            val rows = context.contentResolver.delete(
                uri,
                "address=?",
                arrayOf(address)
            )
            Log.d(TAG, "Deleted $rows SMS for $address")
        } catch (e: Exception) {
            Log.w(TAG, "Cannot delete SMS: ${e.message}")
        }
    }
}
