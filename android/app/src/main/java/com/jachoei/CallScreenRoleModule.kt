package com.jachoei

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*

class CallScreenRoleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val TAG = "CallScreenRoleModule"
        private const val TRACE_TAG = "CALL_SCREEN_ROLE"
        private const val REQ_CALL_SCREENING_ROLE = 9101
    }

    private var pendingPromise: Promise? = null

    override fun getName(): String = "CallScreenRole"

    init {
        reactContext.addActivityEventListener(this)
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
            promise.resolve(held)
        } catch (e: Exception) {
            Log.e(TAG, "[isCallScreeningEnabled] error", e)
            Log.d(TRACE_TAG, "isCallScreeningEnabled() ERROR: ${e.message}")
            CallBlockerModule.emitCallDebug("CALL_SCREEN_ROLE ERROR: ${e.message}")
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
