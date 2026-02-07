import { useEffect } from "react";
import {
  StatusBar,
  ActivityIndicator,
  View,
  Text,
  PermissionsAndroid,
} from "react-native";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ApolloProvider } from "@apollo/client/react";

import { ScamProtectTabs } from "./src/screens/ScamProtectTabs";
import { client } from "./src/apollo/client";
import { useInitScamSync } from "./src/hooks/useInitScamSync";
import { loadDeviceInfo } from "./src/device/deviceInfo";
import { PostViewScreen } from "./src/screens/PostViewScreen";

import { BlockedLogsSearchScreen } from "./src/screens/BlockedLogsSearchScreen";

import type { RootStackParamList } from "./src/navigation/types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export async function ensureSmsPermissions() {
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ]);
  console.log("[PERM] sms =", res);
}

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
        <Text style={{ marginTop: 8 }}>
          กำลังเตรียมฐานข้อมูลบนเครื่อง...
        </Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false, // ✅ สำคัญมาก
      }}
    >
      <Stack.Screen
        name="ScamProtect"
        component={ScamProtectTabs}
        options={{ headerShown: false }}
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
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <ApolloProvider client={client}>
      <NavigationContainer>
        <StatusBar
          barStyle="light-content"
          backgroundColor="#0b0b0f"
        />
        <Root />
      </NavigationContainer>
    </ApolloProvider>
  );
}
