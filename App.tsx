import React, { useEffect } from "react";
import {
  StatusBar,
  ActivityIndicator,
  View,
  Text,
  PermissionsAndroid,
  Pressable,
  StyleSheet,
  Platform
} from "react-native";

import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ApolloProvider } from "@apollo/client/react";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import BootSplash from "react-native-bootsplash";


import { ScamProtectTabs } from "./src/screens/ScamProtectTabs";
import { client } from "./src/apollo/client";
import { useInitScamSync } from "./src/hooks/useInitScamSync";
import { loadDeviceInfo } from "./src/device/deviceInfo";
import { PostViewScreen } from "./src/screens/PostViewScreen";

import { BlockedLogsSearchScreen } from "./src/screens/BlockedLogsSearchScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import ChatScreen from "./src/screens/ChatUIScreen";
import PostFormScreen from "./src/screens/PostFormScreen";
import SignInScreen from "./src/screens/SignInScreen";
import SettingScreen from "./src/screens/SettingsScreen";

import type { RootStackParamList } from "./src/navigation/types";

import { AuthProvider } from "./src/auth/AuthProvider";

import { GlobalWiresWrapper } from "./src/components/GlobalWiresWrapper";


const Stack = createNativeStackNavigator<RootStackParamList>();

// ✅ ใช้ navigationRef เพื่อสั่ง navigate จากปุ่มลอยใน App.tsx ได้เลย
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export async function ensureSmsPermissions() {
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ]);
  console.log("[PERM] sms =", res);
}

GoogleSignin.configure({
  webClientId: "619965285212-4dqfos2ifns1bdgo2anudj4c3gm8ttih.apps.googleusercontent.com",
  offlineAccess: false,
});

function Root() {
  const { ready } = useInitScamSync();

  useEffect(() => {
    ensureSmsPermissions();
    loadDeviceInfo();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>กำลังเตรียมฐานข้อมูลบนเครื่อง...</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
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
          title: "ค้นหา Blocked Logs",
          presentation: "card",
          headerBackTitle: "กลับ",
        }}
      />

      <Stack.Screen
        name="PostView"
        component={PostViewScreen}
        options={{
          title: "รายละเอียดโพสต์",
          presentation: "card",
        }}
      />

      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          headerShown: true,
          title: "User Profile",
          presentation: "card",
        }}
      />

      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerShown: true, title: "Chat", presentation: "card" }}
      />

      <Stack.Screen
        name="PostForm"
        component={PostFormScreen}
        // options={{ headerShown: true, title: "สร้าง/แก้ไขรายการ" }}

        options={{
          headerShown: false,
          title: "สร้าง/แก้ไขรายการ",
          presentation: "modal",

          gestureEnabled: true,
          animation: "slide_from_bottom", //Platform.OS === "ios" ? "slide_from_bottom" : "fade",
          animationDuration: 250,
        }}
      />

      <Stack.Screen
        name="Setting"
        component={SettingScreen}
        options={{ headerShown: true, title: "สร้าง/แก้ไขรายการ" }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <ApolloProvider client={client}>
      <AuthProvider>
      <NavigationContainer 
        ref={navigationRef}
        onReady={() => { BootSplash.hide(); }}>
        <GlobalWiresWrapper />
        <StatusBar barStyle="light-content" backgroundColor="#0b0b0f" />

        <View style={{ flex: 1 }}>
          <Root />

          {/* ✅ ปุ่มลอย: กดเพื่อเปิด SignIn */}
          {/* <Pressable
            style={styles.fab}
            onPress={() => {
              if (navigationRef.isReady()) {
                navigationRef.navigate("SignIn");
              }
            }}
          >
            <Text style={styles.fabText}>Sign In</Text>
          </Pressable> */}
        </View>
      </NavigationContainer>
      </AuthProvider>
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
