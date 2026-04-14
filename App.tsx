import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  StatusBar,
  ActivityIndicator,
  View,
  Text,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Pressable,
  StyleSheet,
  Platform,
  InteractionManager,
  AppState,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import SystemNavigationBar from "react-native-system-navigation-bar";
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ApolloProvider } from "@apollo/client/react";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import BootSplash from "react-native-bootsplash";
import { ScamProtectTabs } from "./src/screens/ScamProtectTabs";
import { client } from "./src/apollo/client";
import { useInitScamSync } from "./src/hooks/useInitScamSync";
import { loadDeviceInfo } from "./src/device/deviceInfo";
import { ensureSessionId } from "./src/lib/observability/session";
import { installGlobalErrorHandlers } from "./src/lib/observability/globalErrors";
import { flushClientLogQueue } from "./src/lib/observability/clientLog";
import { setLogRouteName } from "./src/lib/observability/logContext";
import { PostViewScreen } from "./src/screens/PostViewScreen";
import { EntityDetailScreen } from "./src/screens/EntityDetailScreen";
import { BlockedLogsSearchScreen } from "./src/screens/BlockedLogsSearchScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import ChatScreen from "./src/screens/ChatUIScreen";
import PostFormScreen from "./src/screens/PostFormScreen";
import SignInScreen from "./src/screens/SignInScreen";
import SettingScreen from "./src/screens/SettingsScreen";

import NotificationPage from "./src/screens/NotificationPage";
import DiagnosticsScreen from "./src/screens/DiagnosticsScreen";
import { MoreHelpScreen } from "./src/screens/MoreHelpScreen";
import { MorePrivacyScreen } from "./src/screens/MorePrivacyScreen";
import { MoreAboutScreen } from "./src/screens/MoreAboutScreen";

import type { RootStackParamList } from "./src/navigation/types";

import { AuthProvider } from "./src/auth/AuthProvider";
import { useAuth } from "./src/auth/AuthProvider";

import { GlobalWiresWrapper } from "./src/components/GlobalWiresWrapper";
import { FcmWires } from "./src/notifications/fcmWires";
import { LanguageProvider, useI18n } from "./src/i18n";

import Toast from "react-native-toast-message";


const Stack = createNativeStackNavigator<RootStackParamList>();

// ✅ ใช้ navigationRef เพื่อสั่ง navigate จากปุ่มลอยใน App.tsx ได้เลย
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export async function ensureSmsPermissions() {
  if (Platform.OS !== "android") return;
  const res = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
  );
  console.log("[PERM] RECEIVE_SMS =", res);
}

export async function ensureNotificationPermission() {
  if (Platform.OS !== "android") return;
  // Android 13+ runtime permission
  if (Platform.Version < 33) return;

  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const res = await PermissionsAndroid.request(perm);
  console.log("[PERM] POST_NOTIFICATIONS =", res);
}

GoogleSignin.configure({
  webClientId: "619965285212-4dqfos2ifns1bdgo2anudj4c3gm8ttih.apps.googleusercontent.com",
  iosClientId: "619965285212-s5hpe2qkv53pkd46svrb9a0eq686ec7t.apps.googleusercontent.com",
  offlineAccess: false,
});

function Root({ initReady }: { initReady: boolean }) {
  const { t } = useI18n();

  useEffect(() => {
    // Install global error + rejection capture ASAP.
    installGlobalErrorHandlers();

    // Optional global helper
    (globalThis as any).callDebug = (msg: any) => {
      console.log("CALL_DEBUG:", msg);
    };

    // Debug helper: synthetic incoming-call flow (bridge verification)
    ;(globalThis as any).debugIncomingCall = async (rawNumber: string) => {
      try {
        const mod = (NativeModules as any).CallBlocker;
        if (!mod?.debugSimulateIncomingCall) {
          console.log("debugIncomingCall: native method not available");
          return;
        }
        const res = await mod.debugSimulateIncomingCall(String(rawNumber ?? ""));
        console.log("debugIncomingCall RESULT:", res);
      } catch (e) {
        console.log("debugIncomingCall ERROR:", e);
      }
    };

    const mod = (NativeModules as any).CallBlocker;
    if (!mod) return;

    const emitter = new NativeEventEmitter(mod);
    const sub = emitter.addListener("CALL_DEBUG_EVENT", (event: any) => {
      try {
        console.log("CALL_DEBUG_EVENT:", JSON.stringify(event ?? null, null, 2));
      } catch (e) {
        console.log("CALL_DEBUG_EVENT:", event);
        console.log("CALL_DEBUG_EVENT stringify ERROR:", e);
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    ensureSmsPermissions();
    ensureNotificationPermission();
    loadDeviceInfo();

    // Session id is used for log replay/timeline on the server.
    void ensureSessionId();
  }, []);

  if (!initReady) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0b0b0f",
        }}
      >
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: "#fff" }}>
          {t("app.preparing_local_db")}
        </Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0b0b0f" },
      }}
    >
      {/* ✅ หน้าแรกเป็น ScamProtect ตามเดิม ไม่บังคับ login */}
      <Stack.Screen
        name="ScamProtect"
        component={ScamProtectTabs}
        options={{ headerShown: false }}
      />

      {/* ✅ SignIn เปิดทีหลัง (แนะนำ modal) */}
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{
          headerShown: false,
          presentation: "modal",

          gestureEnabled: true,
          animation: "slide_from_bottom", //Platform.OS === "ios" ? "slide_from_bottom" : "fade",
          animationDuration: 250,
        }}
      />

      {/* 🔍 SEARCH PAGE */}
      <Stack.Screen
        name="BlockedLogsSearch"
        component={BlockedLogsSearchScreen}
        options={{
          headerShown: true,
          title: t("app.blocked_logs_search_title"),
          presentation: "card",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="EntityDetail"
        component={EntityDetailScreen}
        options={{
          headerShown: true,
          title: "Details",
          presentation: "card",
          headerBackVisible: false,
          headerLeft() {
            return (
              <Pressable
                onPress={() => navigationRef.goBack()}
                style={{ paddingHorizontal: 4 }}
              >
                <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="PostView"
        component={PostViewScreen}
        options={{
          title: t("app.post_detail_title"),
          presentation: "card",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          headerShown: true,
          title: t("profile.title"),
          presentation: "card",

          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ 
          headerShown: true, 
          title: t("app.chat_title"), 
          presentation: "card" ,
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      {/* <Stack.Screen
        name="PostForm"
        component={PostFormScreen}
        options={{
          headerShown: false,
          title: "สร้าง/แก้ไขรายการ",
          presentation: "modal",

          gestureEnabled: true,
          animation: "slide_from_bottom", //Platform.OS === "ios" ? "slide_from_bottom" : "fade",
          animationDuration: 250,
          
        }}
      /> */}

      <Stack.Screen
        name="PostForm"
        component={PostFormScreen}
        options={({ navigation }) => ({
          title: t("app.post_form_title"),
          presentation: "modal",
          headerShown: true,                 // ✅ เปิด header
          gestureEnabled: true,
          animation: "slide_from_bottom",
          animationDuration: 250,
          headerBackVisible: false,          // ✅ ไม่ใช้ back แบบ <
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={10}
              style={({ pressed }) => ({
                opacity: pressed ? 0.5 : 1,
                backgroundColor: "transparent",
                padding: 4,
              })}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          ),
        })}
      />

       {/* Notifications Page */}
      <Stack.Screen
        name="Notifications"
        component={NotificationPage}
        options={{
          headerShown: true,
          title: t("app.notifications_title"),
          headerStyle: { backgroundColor: "#0b0b0f" },
          headerTintColor: "#fff",

          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="Setting"
        component={SettingScreen}
        options={{ 
          headerShown: true, 
          title: t("app.settings_title"),
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
         }}
      />

      <Stack.Screen
        name="MoreHelp"
        component={MoreHelpScreen}
        options={{
          headerShown: true,
          title: t("more.help_title"),
          headerStyle: { backgroundColor: "#0b0b0f" },
          headerTintColor: "#fff",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="MorePrivacy"
        component={MorePrivacyScreen}
        options={{
          headerShown: true,
          title: t("more.privacy_title"),
          headerStyle: { backgroundColor: "#0b0b0f" },
          headerTintColor: "#fff",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="MoreAbout"
        component={MoreAboutScreen}
        options={{
          headerShown: true,
          title: t("more.about_title"),
          headerStyle: { backgroundColor: "#0b0b0f" },
          headerTintColor: "#fff",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                  onPress={() => navigationRef.goBack()}
                  style={{ paddingHorizontal: 4 }}
                >
                  <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />

      <Stack.Screen
        name="Diagnostics"
        component={DiagnosticsScreen}
        options={{
          headerShown: true,
          title: "Diagnostics",
          presentation: "card",
          headerBackVisible: false,
          headerLeft(props) {
            return (
              <Pressable
                onPress={() => navigationRef.goBack()}
                style={{ paddingHorizontal: 4 }}
              >
                <Ionicons name="chevron-back" size={26} color="#fff" />
              </Pressable>
            );
          },
        }}
      />
    </Stack.Navigator>
  );
}

function AppShell() {
  const { ready: languageReady, t } = useI18n();
  const { booting } = useAuth();
  const { ready: initReady } = useInitScamSync();

  const [navReady, setNavReady] = useState(false);
  const hasHiddenSplashRef = useRef(false);

  const appReady = useMemo(() => {
    return navReady && !booting && initReady;
  }, [booting, initReady, navReady]);

  useEffect(() => {
    // Keep route context up to date for logs.
    const update = () => {
      try {
        const route = navigationRef.getCurrentRoute();
        setLogRouteName(route?.name ? String(route.name) : null);
      } catch {
        // ignore
      }
    };

    update();
    const unsub = navigationRef.addListener?.("state", update as any);
    return () => {
      try {
        (unsub as any)?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    // Opportunistic flush on app becoming interactive.
    if (!appReady) return;
    void flushClientLogQueue();
  }, [appReady]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushClientLogQueue();
      }
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!appReady) return;
    if (hasHiddenSplashRef.current) return;
    hasHiddenSplashRef.current = true;

    InteractionManager.runAfterInteractions(() => {
      BootSplash.hide({ fade: true }).catch(() => {
        // no-op: avoid crashing if hide is called in a bad state
      });
    });
  }, [appReady]);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    // Keep Android navigation bar consistent with the app dark theme.
    const navBarColor = "#0b0b0f";
    const iconStyle = "light";

    SystemNavigationBar.setNavigationColor(navBarColor, iconStyle).catch(() => {
      // no-op
    });
  }, []);

  if (!languageReady) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0b0b0f",
        }}
      >
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: "#fff" }}>{t("common.loading")}</Text>
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={{
        prefixes: ["jachoei://chat"],
        config: {
          screens: {
            Chat: ":chatId",
          },
        },
      }}
      theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: "#0b0b0f",
        },
      }}
      onReady={() => setNavReady(true)}
      onStateChange={() => {
        try {
          const route = navigationRef.getCurrentRoute();
          setLogRouteName(route?.name ? String(route.name) : null);
        } catch {
          // ignore
        }

        // Flush in background (best-effort) after navigation changes.
        void flushClientLogQueue();
      }}
    >
      <GlobalWiresWrapper />
      <FcmWires />
      <StatusBar barStyle="light-content" backgroundColor="#0b0b0f" />
      <View style={{ flex: 1 }}>
        <Root initReady={initReady} />
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ApolloProvider client={client}>
      <LanguageProvider>
        <AuthProvider>
          <AppShell />
          <Toast />
        </AuthProvider>
      </LanguageProvider>
    </ApolloProvider>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    bottom: 22,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00e5ff",
  },
  fabText: {
    fontWeight: "900",
    color: "#071014",
  },
});
