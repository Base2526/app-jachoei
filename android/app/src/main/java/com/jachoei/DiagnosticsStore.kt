package com.jachoei

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Release-safe, persisted diagnostics ring buffer.
 * Stores small JSON events in SharedPreferences so Play Store builds can be debugged
 * without relying on logcat.
 */
object DiagnosticsStore {
    private const val PREFS = "jachoei_diagnostics"
    private const val KEY_EVENTS = "events"
    private const val MAX_EVENTS = 200

    fun record(context: Context, topic: String, msg: String, data: Map<String, Any?>? = null) {
        try {
            val appCtx = context.applicationContext
            val prefs = appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

            val raw = prefs.getString(KEY_EVENTS, null)
            val arr = try {
                if (raw.isNullOrBlank()) JSONArray() else JSONArray(raw)
            } catch (_: Exception) {
                JSONArray()
            }

            val ev = JSONObject()
            ev.put("ts", System.currentTimeMillis())
            ev.put("topic", topic.take(64))
            ev.put("msg", msg.take(800))

            if (data != null && data.isNotEmpty()) {
                val m = JSONObject()
                for ((k, v) in data) {
                    val key = k.take(64)
                    when (v) {
                        null -> m.put(key, JSONObject.NULL)
                        is Boolean, is Int, is Long, is Double, is Float -> m.put(key, v)
                        else -> m.put(key, v.toString().take(1000))
                    }
                }
                ev.put("data", m)
            }

            arr.put(ev)

            // Trim oldest
            while (arr.length() > MAX_EVENTS) {
                try {
                    // JSONArray has no remove on old API levels; rebuild.
                    val trimmed = JSONArray()
                    val start = arr.length() - MAX_EVENTS
                    for (i in start until arr.length()) trimmed.put(arr.get(i))
                    prefs.edit().putString(KEY_EVENTS, trimmed.toString()).apply()
                    return
                } catch (_: Exception) {
                    break
                }
            }

            prefs.edit().putString(KEY_EVENTS, arr.toString()).apply()
        } catch (_: Exception) {
            // best-effort only
        }
    }

    fun read(context: Context): JSONArray {
        return try {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val raw = prefs.getString(KEY_EVENTS, null)
            if (raw.isNullOrBlank()) JSONArray() else JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }

    fun clear(context: Context) {
        try {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.edit().remove(KEY_EVENTS).apply()
        } catch (_: Exception) {
            // best-effort only
        }
    }
}
