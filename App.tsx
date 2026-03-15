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
import Ionicons from "react-native-vector-icons/Ionicons";
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

import NotificationPage from "./src/screens/NotificationPage";

import type { RootStackParamList } from "./src/navigation/types";

import { AuthProvider } from "./src/auth/AuthProvider";

import { GlobalWiresWrapper } from "./src/components/GlobalWiresWrapper";

import Toast from "react-native-toast-message";


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
  iosClientId: "619965285212-s5hpe2qkv53pkd46svrb9a0eq686ec7t.apps.googleusercontent.com",
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
        name="PostView"
        component={PostViewScreen}
        options={{
          title: "รายละเอียดโพสต์",
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
          title: "User Profile",
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
          title: "Chat", 
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
          title: "สร้าง/แก้ไขรายการ",
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
          title: "Notifications",
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
          title: "สร้าง/แก้ไขรายการ",
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
        </View>
      </NavigationContainer>
      <Toast />
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
