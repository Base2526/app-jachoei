# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- React Native + app components (safety for release/store builds) ---
# These classes are referenced via AndroidManifest / React Native module registration.
-keep class com.jachoei.CallBlockerService { *; }
-keep class com.jachoei.SmsBlockerReceiver { *; }
-keep class com.jachoei.CallBlockerModule { *; }
-keep class com.jachoei.CallBlockerPackage { *; }
-keep class com.jachoei.CallScreenRoleModule { *; }
-keep class com.jachoei.CallScreenRolePackage { *; }
-keep class com.jachoei.DiagnosticsStore { *; }

# --- Call screening + DB lookup helpers (defensive) ---
-keep class com.jachoei.PhoneUtils { *; }
-keep class com.jachoei.BlockLogUtils { *; }
-keep class com.jachoei.JachoeiNotificationUtils { *; }

# Keep React Native bridge annotations and generated/native binding bits.
-keepclassmembers class * {
	@com.facebook.react.bridge.ReactMethod <methods>;
}

# Kotlin: keep metadata used by reflection/stacktraces (low risk).
-keep class kotlin.Metadata { *; }
