package com.myapp

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log
import com.facebook.react.bridge.*

class SmsRoleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val TAG = "SmsRoleModule"
        private const val REQUEST_CODE_SMS_ROLE = 9001
    }

    private var pendingPromise: Promise? = null

    override fun getName(): String = "SmsRole"

    init {
        // ลงทะเบียน ActivityEventListener ให้ module นี้
        reactContext.addActivityEventListener(this)
    }

    // ---------------------------
    // ตรวจว่าเป็น Default SMS app แล้วหรือยัง
    // ---------------------------
    @ReactMethod
    fun isDefaultSmsApp(promise: Promise) {
        try {
            val myPkg = reactContext.packageName
            val current = Telephony.Sms.getDefaultSmsPackage(reactContext)
            val isDefault = (myPkg == current)

            Log.d(TAG, "[isDefaultSmsApp] myPkg=$myPkg current=$current isDefault=$isDefault")
            promise.resolve(isDefault)
        } catch (e: Exception) {
            Log.e(TAG, "[isDefaultSmsApp] error", e)
            promise.reject("CHECK_ERROR", e)
        }
    }

    // ---------------------------
    // ขอสิทธิ์เป็น Default SMS app
    // ---------------------------
    @ReactMethod
    fun requestDefaultSmsRole(promise: Promise) {
        val activity: Activity? = getCurrentActivity()
        if (activity == null) {
            Log.e(TAG, "[requestDefaultSmsRole] currentActivity is null")
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }

        val myPkg = reactContext.packageName
        val current = Telephony.Sms.getDefaultSmsPackage(reactContext)

        Log.d(TAG, "[requestDefaultSmsRole] myPkg=$myPkg current=$current")

        if (myPkg == current) {
            Log.d(TAG, "[requestDefaultSmsRole] already default SMS app")
            promise.resolve(true)
            return
        }

        if (pendingPromise != null) {
            promise.reject("ALREADY_REQUESTING", "Another SMS role request is in progress")
            return
        }

        pendingPromise = promise

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val roleManager =
                    reactContext.getSystemService(RoleManager::class.java) as RoleManager

                val available = roleManager.isRoleAvailable(RoleManager.ROLE_SMS)
                Log.d(TAG, "[requestDefaultSmsRole] ROLE_SMS available=$available")

                if (!available) {
                    // อุปกรณ์นี้ไม่มี ROLE_SMS (เช่น ไม่มีโทรศัพท์)
                    pendingPromise?.resolve(false)
                    pendingPromise = null
                    return
                }

                val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_SMS)
                Log.d(TAG, "[requestDefaultSmsRole] startActivityForResult via RoleManager")
                activity.startActivityForResult(intent, REQUEST_CODE_SMS_ROLE)
            } else {
                val intent = Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).apply {
                    putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, myPkg)
                }
                Log.d(TAG, "[requestDefaultSmsRole] startActivityForResult via ACTION_CHANGE_DEFAULT")
                activity.startActivityForResult(intent, REQUEST_CODE_SMS_ROLE)
            }
        } catch (e: Exception) {
            Log.e(TAG, "[requestDefaultSmsRole] error starting intent", e)
            pendingPromise?.reject("REQUEST_ERROR", e)
            pendingPromise = null
        }
    }

    // ---------------------------
    // ActivityEventListener
    // ---------------------------
    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != REQUEST_CODE_SMS_ROLE) {
            return
        }

        val promise = pendingPromise ?: return
        pendingPromise = null

        val myPkg = reactContext.packageName
        val current = Telephony.Sms.getDefaultSmsPackage(reactContext)
        val isNowDefault = (myPkg == current)

        Log.d(
            TAG,
            "[onActivityResult] requestCode=$requestCode resultCode=$resultCode isNowDefault=$isNowDefault"
        )

        // user กดตกลงหรือไม่ จากมุมมองเรา → ดูแค่ว่าตอนนี้เป็น default แล้วหรือยัง
        promise.resolve(isNowDefault)
    }

    override fun onNewIntent(intent: Intent) {
        // ไม่ได้ใช้ แต่ต้อง implement ให้ตรง interface
        Log.d(TAG, "[onNewIntent] intent=$intent (not used)")
    }
}
