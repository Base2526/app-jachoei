package com.jachoei

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.zoontek.rnbootsplash.RNBootSplash

class MainActivity : ReactActivity() {

  companion object {
    private const val ROLE_TAG = "ROLE_DEBUG"
    private const val REQ_ROLE_CALL_SCREENING = 7331
  }

  private fun logRole(msg: String) {
    Log.d(ROLE_TAG, msg)
    CallBlockerModule.emitCallDebug(
      source = ROLE_TAG,
      msg = msg,
      action = "ROLE_DEBUG",
    )
  }

  private fun ensureCallScreeningRole() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      logRole("ROLE_CALL_SCREENING not supported (sdk=${Build.VERSION.SDK_INT})")
      return
    }

    val rm = getSystemService(RoleManager::class.java)
    if (rm == null) {
      logRole("RoleManager unavailable")
      return
    }

    val role = RoleManager.ROLE_CALL_SCREENING
    val available = rm.isRoleAvailable(role)
    val held = rm.isRoleHeld(role)
    logRole("ROLE_CALL_SCREENING available=$available held=$held")

    if (!available) return
    if (held) return

    try {
      val intent = rm.createRequestRoleIntent(role)
      logRole("ROLE_CALL_SCREENING request START")
      @Suppress("DEPRECATION")
      startActivityForResult(intent, REQ_ROLE_CALL_SCREENING)
    } catch (e: Exception) {
      logRole("ROLE_CALL_SCREENING request ERROR: ${e.message}")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    RNBootSplash.init(this, R.style.BootTheme) // ensures BootTheme is used only for cold start

    // Keep system bars consistent with the app dark theme (avoid white nav bar).
    val dark = ContextCompat.getColor(this, R.color.bootsplash_background)
    window.statusBarColor = dark
    window.navigationBarColor = dark

    // Ensure system bar icons are light.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.setSystemBarsAppearance(
        0,
        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
          android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      )
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility =
        window.decorView.systemUiVisibility and
          View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv() and
          View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
    }

    super.onCreate(savedInstanceState)

    // Call screening role is required for the system to invoke CallScreeningService callbacks.
    ensureCallScreeningRole()
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)

    if (requestCode != REQ_ROLE_CALL_SCREENING) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return

    val rm = getSystemService(Context.ROLE_SERVICE) as? RoleManager
    if (rm == null) {
      logRole("ROLE_CALL_SCREENING result: RoleManager unavailable")
      return
    }

    val held = rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)
    val ok = resultCode == Activity.RESULT_OK
    logRole("ROLE_CALL_SCREENING result ok=$ok held=$held resultCode=$resultCode")
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MyApp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
