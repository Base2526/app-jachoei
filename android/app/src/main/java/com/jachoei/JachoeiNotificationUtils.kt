package com.jachoei

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import kotlin.math.abs

object JachoeiNotificationUtils {

    private const val LOCAL_BLOCK_CHANNEL_ID = "jachoei_local_block"
    private const val LOCAL_BLOCK_CHANNEL_NAME = "Local block confirmations"

    @Volatile private var appContext: Context? = null

    // Simple in-memory dedup to avoid double notifications from the same action.
    @Volatile private var lastLocalBlockPhone: String? = null
    @Volatile private var lastLocalBlockAtMs: Long = 0

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun formatPhoneForNotification(phone: String): String {
        val p = phone.trim().removePrefix("+")
        // Thai: 66xxxxxxxxx (11) -> 0xxxxxxxxx
        return if (p.startsWith("66") && p.length == 11) {
            "0" + p.substring(2)
        } else {
            phone.trim()
        }
    }

    private fun ensureLocalBlockChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val existing = nm.getNotificationChannel(LOCAL_BLOCK_CHANNEL_ID)
        if (existing != null) return

        val ch = NotificationChannel(
            LOCAL_BLOCK_CHANNEL_ID,
            LOCAL_BLOCK_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        )
        nm.createNotificationChannel(ch)
    }

    fun showLocalBlockNotification(phone: String) {
        val ctx = appContext ?: return
        showLocalBlockNotification(ctx, phone)
    }

    fun showLocalBlockNotification(context: Context, phone: String) {
        try {
            val now = System.currentTimeMillis()
            val trimmed = phone.trim()
            if (trimmed.isEmpty()) return

            // Dedupe: same phone within 2 seconds.
            if (trimmed == lastLocalBlockPhone && (now - lastLocalBlockAtMs) < 2_000) {
                return
            }
            lastLocalBlockPhone = trimmed
            lastLocalBlockAtMs = now

            ensureLocalBlockChannel(context)

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val display = formatPhoneForNotification(trimmed)

            val n = NotificationCompat.Builder(context, LOCAL_BLOCK_CHANNEL_ID)
                .setSmallIcon(context.applicationInfo.icon)
                .setContentTitle("Blocked number")
                .setContentText("$display has been blocked")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .build()

            val id = abs(("local_block:" + trimmed).hashCode())
            nm.notify(id, n)
        } catch (_: Exception) {
            // best-effort only
        }
    }
}
