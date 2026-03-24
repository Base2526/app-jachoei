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
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                // Android < 10 ไม่มีระบบ Role แบบนี้
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "[isCallScreeningEnabled] Android < 10 → false")
                }
                promise.resolve(false)
                return
            }

            val roleManager =
                reactContext.getSystemService(RoleManager::class.java) as RoleManager
            val held = roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)

            if (BuildConfig.DEBUG) {
                Log.d(TAG, "[isCallScreeningEnabled] held=$held")
            }
            promise.resolve(held)
        } catch (e: Exception) {
            Log.e(TAG, "[isCallScreeningEnabled] error", e)
            promise.reject("CHECK_ERROR", e)
        }
    }

    // ขอ ROLE_CALL_SCREENING จากระบบ
    @ReactMethod
    fun requestCallScreeningRole(promise: Promise) {
        val activity: Activity? = reactContext.currentActivity
        if (activity == null) {
            if (BuildConfig.DEBUG) {
                Log.e(TAG, "[requestCallScreeningRole] currentActivity is null")
            }
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (BuildConfig.DEBUG) {
                Log.e(TAG, "[requestCallScreeningRole] Android < 10, unsupported")
            }
            promise.reject("UNSUPPORTED", "ROLE_CALL_SCREENING requires Android 10+")
            return
        }

        val roleManager =
            reactContext.getSystemService(RoleManager::class.java) as RoleManager

        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "[requestCallScreeningRole] already held")
            }
            promise.resolve(true)
            return
        }

        if (pendingPromise != null) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "[requestCallScreeningRole] already requesting, skip")
            }
            promise.reject("ALREADY_REQUESTING", "Another request in progress")
            return
        }

        pendingPromise = promise

        try {
            val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "[requestCallScreeningRole] startActivityForResult ROLE_CALL_SCREENING")
            }
            activity.startActivityForResult(intent, REQ_CALL_SCREENING_ROLE)
        } catch (e: Exception) {
            Log.e(TAG, "[requestCallScreeningRole] error starting intent", e)
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

        if (BuildConfig.DEBUG) {
            Log.d(
                TAG,
                "[onActivityResult] req=$requestCode result=$resultCode held=$held"
            )
        }

        promise.resolve(held)
    }

    override fun onNewIntent(intent: Intent) {
        // ไม่ได้ใช้ แต่ต้อง implement ให้ครบ interface
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "[onNewIntent] (not used)")
        }
    }
}
