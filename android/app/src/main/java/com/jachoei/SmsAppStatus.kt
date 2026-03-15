// android/app/src/main/java/com/myapp/SmsAppStatus.kt
package com.jachoei

import android.content.Context
import android.os.Build
import android.provider.Telephony

object SmsAppStatus {

    fun isDefaultSmsApp(context: Context): Boolean {
        val myPackage = context.packageName
        val defaultSmsPackage = Telephony.Sms.getDefaultSmsPackage(context)
        return myPackage == defaultSmsPackage
    }
}
