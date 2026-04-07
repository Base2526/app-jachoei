package com.jachoei

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.telecom.TelecomManager
import android.util.Log
import com.facebook.react.bridge.*
import java.security.MessageDigest

class CallScreenRoleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val TAG = "CallScreenRoleModule"
        private const val LOG_TAG = "JACHOEI_CALL"
        private const val TRACE_TAG = "CALL_SCREEN_ROLE"
        private const val REQ_CALL_SCREENING_ROLE = 9101
    }

    private var pendingPromise: Promise? = null

    override fun getName(): String = "CallScreenRole"

    init {
        reactContext.addActivityEventListener(this)
    }

    private fun logInfo(msg: String) {
        Log.i(LOG_TAG, msg)
        CallBlockerModule.emitCallDebug(
            source = TRACE_TAG,
            msg = msg,
            action = "ROLE_STATUS",
        )
    }

    private fun heldRoleCallScreening(): Boolean? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        val rm = reactContext.getSystemService(RoleManager::class.java) ?: return null
        return try {
            rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
        } catch (_: Exception) {
            null
        }
    }

    private fun isProbablyEmulator(): Boolean {
        val fp = (android.os.Build.FINGERPRINT ?: "").lowercase()
        val model = (android.os.Build.MODEL ?: "").lowercase()
        val product = (android.os.Build.PRODUCT ?: "").lowercase()
        val brand = (android.os.Build.BRAND ?: "").lowercase()
        return fp.contains("generic") || fp.contains("emulator") ||
            model.contains("emulator") || model.contains("sdk") ||
            product.contains("sdk") || product.contains("emulator") ||
            brand.contains("generic")
    }

    // Best-effort: some Android versions expose default call screening app via TelecomManager.
    private fun getTelecomDefaultCallScreeningPackage(): String? {
        val tm = reactContext.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return null

        // Try known method name(s) via reflection to avoid compile-time API coupling.
        val candidates = listOf(
            "getDefaultCallScreeningApp",
        )
        for (name in candidates) {
            try {
                val m = tm.javaClass.getMethod(name)
                val res = m.invoke(tm)
                when (res) {
                    is ComponentName -> return res.packageName
                    is String -> return res
                    else -> {
                        // ignore
                    }
                }
            } catch (_: Exception) {
                // ignore
            }
        }

        return null
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        val d = md.digest(bytes)
        val sb = StringBuilder(d.size * 2)
        for (b in d) sb.append(String.format("%02x", b))
        return sb.toString()
    }

    private fun getSigningCertSha256(): String? {
        return try {
            val pm = reactContext.packageManager
            val pkg = reactContext.packageName
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                val pi = pm.getPackageInfo(pkg, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
                val si = pi.signingInfo ?: return null
                val certs = if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
                val first = certs?.firstOrNull() ?: return null
                sha256Hex(first.toByteArray())
            } else {
                @Suppress("DEPRECATION")
                val pi = pm.getPackageInfo(pkg, android.content.pm.PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                val sig = pi.signatures?.firstOrNull() ?: return null
                @Suppress("DEPRECATION")
                sha256Hex(sig.toByteArray())
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun getInstallerPackage(): String? {
        val pm = reactContext.packageManager
        val pkg = reactContext.packageName
        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val src = pm.getInstallSourceInfo(pkg)
                src.installingPackageName ?: src.initiatingPackageName ?: src.originatingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(pkg)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun getVersionInfo(): Pair<Long, String> {
        return try {
            val pm = reactContext.packageManager
            val pkg = reactContext.packageName
            val pi = pm.getPackageInfo(pkg, 0)
            val vc = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pi.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pi.versionCode.toLong()
            }
            Pair(vc, pi.versionName ?: "")
        } catch (_: Exception) {
            Pair(0L, "")
        }
    }

    @ReactMethod
    fun getAppInstallDiagnostics(promise: Promise) {
        try {
            val pkg = reactContext.packageName
            val (vc, vn) = getVersionInfo()
            val installer = getInstallerPackage()
            val cert = getSigningCertSha256()

            val out = Arguments.createMap()
            out.putString("packageName", pkg)
            out.putString("applicationId", BuildConfig.APPLICATION_ID)
            out.putString("buildType", BuildConfig.BUILD_TYPE)
            out.putBoolean("debug", BuildConfig.DEBUG)
            out.putDouble("versionCode", vc.toDouble())
            out.putString("versionName", vn)
            if (!installer.isNullOrBlank()) out.putString("installer", installer)
            if (!cert.isNullOrBlank()) out.putString("signingCertSha256", cert)

            DiagnosticsStore.record(
                context = reactContext,
                topic = "APP_INSTALL",
                msg = "install_diagnostics",
                data = mapOf(
                    "packageName" to pkg,
                    "applicationId" to BuildConfig.APPLICATION_ID,
                    "buildType" to BuildConfig.BUILD_TYPE,
                    "debug" to BuildConfig.DEBUG,
                    "versionCode" to vc,
                    "versionName" to vn,
                    "installer" to (installer ?: ""),
                    "signingCertSha256" to (cert ?: ""),
                ),
            )

            promise.resolve(out)
        } catch (e: Exception) {
            DiagnosticsStore.record(
                context = reactContext,
                topic = "APP_INSTALL",
                msg = "install_diagnostics_error",
                data = mapOf(
                    "error" to (e.message ?: "unknown"),
                ),
            )
            promise.reject("INSTALL_DIAG_ERROR", e)
        }
    }

    /**
     * Returns a structured status object for UI gating (no silent failures).
     * enabled=true means the system should invoke CallScreeningService.
     */
    @ReactMethod
    fun getCallScreeningStatus(promise: Promise) {
        try {
            val sdk = Build.VERSION.SDK_INT
            val pkg = reactContext.packageName
            val supported = sdk >= Build.VERSION_CODES.N

            val emulator = isProbablyEmulator()

            val held = heldRoleCallScreening()
            val telecomDefaultPkg = getTelecomDefaultCallScreeningPackage()

            val enabled = when {
                held == true -> true
                held == false -> false
                telecomDefaultPkg != null -> telecomDefaultPkg == pkg
                else -> false
            }

            val state = when {
                !supported -> "UNSUPPORTED"
                enabled -> "ENABLED"
                held == false || (telecomDefaultPkg != null && telecomDefaultPkg != pkg) -> "NOT_ENABLED"
                else -> "UNKNOWN"
            }

            val reason = when {
                !supported -> "UNSUPPORTED_SDK"
                enabled -> "ENABLED"
                sdk >= Build.VERSION_CODES.Q && held == false -> "NOT_DEFAULT_SPAM_APP"
                sdk >= Build.VERSION_CODES.Q && held == null -> "ROLE_CHECK_FAILED"
                telecomDefaultPkg != null && telecomDefaultPkg != pkg -> "NOT_DEFAULT_SPAM_APP"
                sdk < Build.VERSION_CODES.Q -> "ANDROID_LT_Q_NEEDS_MANUAL_ENABLE"
                else -> "UNKNOWN"
            }

            if (!enabled) {
                logInfo("CALL_SCREEN_NOT_ENABLED_REASON=$reason")
                logInfo("CALL_SCREEN_STATUS state=$state sdk=$sdk emulator=$emulator")
            } else {
                logInfo("CALL_SCREEN_STATUS state=$state sdk=$sdk emulator=$emulator")
            }

            // Release-safe persisted diagnostics (so Play Store builds can be debugged without logcat).
            DiagnosticsStore.record(
                context = reactContext,
                topic = "CALL_ROLE",
                msg = "status",
                data = mapOf(
                    "state" to state,
                    "enabled" to enabled,
                    "reason" to reason,
                    "sdk" to sdk,
                    "pkg" to pkg,
                    "emulator" to emulator,
                    "roleHeld" to (held ?: "(n/a)"),
                    "telecomDefaultPkg" to (telecomDefaultPkg ?: ""),
                ),
            )

            val out = Arguments.createMap()
            out.putInt("sdk", sdk)
            out.putString("packageName", pkg)
            out.putBoolean("supported", supported)
            out.putBoolean("enabled", enabled)
            out.putString("state", state)
            out.putString("reason", reason)
            if (held != null) out.putBoolean("roleHeld", held)
            if (telecomDefaultPkg != null) out.putString("telecomDefaultPkg", telecomDefaultPkg)
            out.putString("manufacturer", android.os.Build.MANUFACTURER ?: "")
            out.putString("model", android.os.Build.MODEL ?: "")
            out.putBoolean("isEmulator", emulator)

            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "[getCallScreeningStatus] error", e)
            logInfo("CALL_SCREEN_NOT_ENABLED_REASON=STATUS_CHECK_ERROR")
            DiagnosticsStore.record(
                context = reactContext,
                topic = "CALL_ROLE",
                msg = "status_error",
                data = mapOf(
                    "error" to (e.message ?: "unknown"),
                ),
            )
            promise.reject("STATUS_ERROR", e)
        }
    }

    /**
     * Release-safe summary for UI: shows whether the service has ever been created/bound,
     * and the latest screening decision/error, using DiagnosticsStore.
     */
    @ReactMethod
    fun getCallScreeningSummary(promise: Promise) {
        try {
            val arr = DiagnosticsStore.read(reactContext)

            var lastServiceCreateAt = 0L
            var lastServiceBindAt = 0L
            var lastScreenAt = 0L
            var lastDecision: String? = null
            var lastRaw: String? = null
            var lastCanonical: String? = null
            var lastError: String? = null

            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val topic = obj.optString("topic")
                val ts = obj.optLong("ts", 0L)
                val msg = obj.optString("msg")
                val data = obj.optJSONObject("data")

                if (topic == "CALL_SERVICE") {
                    if (msg.contains("onCreate")) lastServiceCreateAt = ts
                    if (msg.contains("onBind")) lastServiceBindAt = ts
                }

                if (topic == "CALL_SCREEN") {
                    // The service records decisions as CALL_SCREEN events.
                    lastScreenAt = ts
                    if (data != null) {
                        lastDecision = data.optString("decision", lastDecision ?: "")
                        lastRaw = data.optString("raw", lastRaw ?: "")
                        lastCanonical = data.optString("canonical", lastCanonical ?: "")
                    }
                    if (msg.startsWith("ALLOW") || msg.startsWith("BLOCK") || msg.startsWith("WARN")) {
                        // ok
                    }
                }

                if (topic == "CALL_SCREEN" && msg.startsWith("ERROR")) {
                    lastError = msg
                }

                if (topic == "CALL_SCREEN" && msg.startsWith("ALLOW") == false && msg.startsWith("BLOCK") == false && msg.startsWith("WARN") == false) {
                    // ignore
                }
            }

            val out = Arguments.createMap()
            out.putDouble("lastServiceCreateAt", lastServiceCreateAt.toDouble())
            out.putDouble("lastServiceBindAt", lastServiceBindAt.toDouble())
            out.putDouble("lastScreenAt", lastScreenAt.toDouble())
            if (!lastDecision.isNullOrBlank()) out.putString("lastDecision", lastDecision)
            if (!lastRaw.isNullOrBlank()) out.putString("lastRaw", lastRaw)
            if (!lastCanonical.isNullOrBlank()) out.putString("lastCanonical", lastCanonical)
            if (!lastError.isNullOrBlank()) out.putString("lastError", lastError)
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("SUMMARY_ERROR", e)
        }
    }

    @ReactMethod
    fun openCallerIdAndSpamSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            logInfo("CALL_SCREEN_SETTINGS_OPEN action=ACTION_MANAGE_DEFAULT_APPS_SETTINGS")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "[openCallerIdAndSpamSettings] error", e)
            promise.reject("OPEN_SETTINGS_ERROR", e)
        }
    }

    /** Optional debug helper: fetch last CALL_SCREEN event recorded by CallBlockerService. */
    @ReactMethod
    fun getLastCallScreeningEvent(promise: Promise) {
        try {
            val arr = DiagnosticsStore.read(reactContext)
            var lastObj: org.json.JSONObject? = null
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (obj.optString("topic") == "CALL_SCREEN") {
                    lastObj = obj
                }
            }

            if (lastObj == null) {
                val out = Arguments.createMap()
                out.putBoolean("found", false)
                promise.resolve(out)
                return
            }

            val out = Arguments.createMap()
            out.putBoolean("found", true)
            out.putDouble("ts", lastObj.optLong("ts", 0L).toDouble())
            out.putString("msg", lastObj.optString("msg", ""))
            val data = lastObj.optJSONObject("data")
            if (data != null) {
                val dm = Arguments.createMap()
                val keys = data.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = data.opt(k)
                    when (v) {
                        null, org.json.JSONObject.NULL -> dm.putNull(k)
                        is Boolean -> dm.putBoolean(k, v)
                        is Int -> dm.putInt(k, v)
                        is Long -> dm.putDouble(k, v.toDouble())
                        is Double -> dm.putDouble(k, v)
                        else -> dm.putString(k, v.toString())
                    }
                }
                out.putMap("data", dm)
            }
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("LAST_EVENT_ERROR", e)
        }
    }

    // เช็คว่า app นี้ถือ ROLE_CALL_SCREENING อยู่หรือยัง
    @ReactMethod
    fun isCallScreeningEnabled(promise: Promise) {
        try {
            Log.d(TRACE_TAG, "isCallScreeningEnabled() sdk=${Build.VERSION.SDK_INT}")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE isCallScreeningEnabled sdk=${Build.VERSION.SDK_INT}")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                // Android < 10 ไม่มีระบบ Role แบบนี้
                Log.d(TRACE_TAG, "Android < 10 -> false")
                CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE unsupported (<10)")
                promise.resolve(false)
                return
            }

            val roleManager =
                reactContext.getSystemService(RoleManager::class.java) as RoleManager
            val held = roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)

            Log.d(TRACE_TAG, "held=$held")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE held=$held")
            if (!held) {
                logInfo("CALL_SCREEN_NOT_ENABLED_REASON=NOT_DEFAULT_SPAM_APP")
            }
            promise.resolve(held)
        } catch (e: Exception) {
            Log.e(TAG, "[isCallScreeningEnabled] error", e)
            Log.d(TRACE_TAG, "isCallScreeningEnabled() ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE ERROR: ${e.message}")
            logInfo("CALL_SCREEN_NOT_ENABLED_REASON=CHECK_ERROR")
            promise.reject("CHECK_ERROR", e)
        }
    }

    @ReactMethod
    fun debugPrintCallScreeningRoleStatus(promise: Promise) {
        try {
            val sdk = Build.VERSION.SDK_INT
            if (sdk < Build.VERSION_CODES.Q) {
                Log.d(TRACE_TAG, "debugStatus sdk=$sdk role=unsupported")
                CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE debugStatus sdk=$sdk unsupported")
                promise.resolve(false)
                return
            }
            val roleManager = reactContext.getSystemService(RoleManager::class.java) as RoleManager
            val available = roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)
            val held = roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
            Log.d(TRACE_TAG, "debugStatus sdk=$sdk available=$available held=$held")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE debugStatus sdk=$sdk available=$available held=$held")
            promise.resolve(held)
        } catch (e: Exception) {
            Log.d(TRACE_TAG, "debugStatus ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE debugStatus ERROR: ${e.message}")
            promise.reject("DEBUG_ERROR", e)
        }
    }

    // ขอ ROLE_CALL_SCREENING จากระบบ
    @ReactMethod
    fun requestCallScreeningRole(promise: Promise) {
        val activity: Activity? = reactContext.currentActivity
        if (activity == null) {
            Log.d(TRACE_TAG, "requestCallScreeningRole() ERROR currentActivity=null")
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.d(TRACE_TAG, "requestCallScreeningRole() unsupported sdk=${Build.VERSION.SDK_INT}")
            promise.reject("UNSUPPORTED", "ROLE_CALL_SCREENING requires Android 10+")
            return
        }

        val roleManager =
            reactContext.getSystemService(RoleManager::class.java) as RoleManager

        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            Log.d(TRACE_TAG, "requestCallScreeningRole() already held")
            promise.resolve(true)
            return
        }

        if (pendingPromise != null) {
            Log.d(TRACE_TAG, "requestCallScreeningRole() already requesting")
            promise.reject("ALREADY_REQUESTING", "Another request in progress")
            return
        }

        pendingPromise = promise

        try {
            val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
            Log.d(TRACE_TAG, "requestCallScreeningRole() startActivityForResult")
            activity.startActivityForResult(intent, REQ_CALL_SCREENING_ROLE)
        } catch (e: Exception) {
            Log.e(TAG, "[requestCallScreeningRole] error starting intent", e)
            Log.d(TRACE_TAG, "requestCallScreeningRole() ERROR: ${e.message}")
            pendingPromise?.reject("REQUEST_ERROR", e)
            pendingPromise = null
        }
    }

    // ActivityEventListener implementation
    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != REQ_CALL_SCREENING_ROLE) return

        val promise = pendingPromise ?: return
        pendingPromise = null

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            promise.resolve(false)
            return
        }

        val roleManager =
            reactContext.getSystemService(RoleManager::class.java) as RoleManager
        val held = roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)

        Log.d(TRACE_TAG, "onActivityResult req=$requestCode result=$resultCode held=$held")

        promise.resolve(held)
    }

    override fun onNewIntent(intent: Intent) {
        // ไม่ได้ใช้ แต่ต้อง implement ให้ครบ interface
        Log.d(TRACE_TAG, "onNewIntent (not used)")
    }
}
