package com.jachoei

import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.zoontek.rnbootsplash.RNBootSplash

class MainActivity : ReactActivity() {

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
