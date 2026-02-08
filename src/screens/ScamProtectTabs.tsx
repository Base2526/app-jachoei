import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Text, View } from "react-native";

import { CheckPhoneScreen } from "./CheckPhoneScreen";
import { BlockedNumbersScreen } from "./BlockedNumbersScreen";
import { BlockedLogsScreen } from "./BlockedLogsScreen";
import { HeaderMenu } from "../components/HeaderMenu";

import { HomeScreen } from "./HomeScreen";

import { useAuth } from "../auth/AuthProvider"

import { HeaderAccountButton } from "../components/HeaderAccountButton";

type TabsParamList = {
  CheckPhone: undefined;
  BlockedNumbers: undefined;
  BlockedLogs: undefined;
  HomeScreen: undefined;
};

const Tab = createBottomTabNavigator<TabsParamList>();

function useBadges() {
  // ตัวอย่างนับแบบ mock (คุณจะไปดึงจาก SQLite/GraphQL/Redux ก็ได้)
  const blockedCount = 12; // เช่น จำนวนเบอร์ที่บล็อก
  const logsCount = 3; // เช่น จำนวน log ใหม่
  return { blockedCount, logsCount };
}

export const ScamProtectTabs: React.FC = () => {
  const { blockedCount, logsCount } = useBadges();

  const { isLoggedIn, user, logout } = useAuth();

  // const isLoggedIn = false;

  const blockedBadge = useMemo<undefined | number | string>(() => {
    if (blockedCount <= 0) return undefined;
    if (blockedCount > 99) return "99+";
    return blockedCount;
  }, [blockedCount]);

  const logsBadge = useMemo<undefined | number | string>(() => {
    if (logsCount <= 0) return undefined;
    if (logsCount > 99) return "99+";
    return logsCount;
  }, [logsCount]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#111" },
        headerTintColor: "#fff",
        headerTitleAlign: "center",

        tabBarStyle: {
          backgroundColor: "#111",
          borderTopColor: "#222",
        },
        tabBarActiveTintColor: "#1e90ff",
        tabBarInactiveTintColor: "#888",
      }}
    >
      {/* ================= Blocked Logs ================= */}
      <Tab.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={({ navigation }) => ({
          headerTitle: () => null,
          headerLeft: () => (
            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                fontWeight: "800",
                marginLeft: 14,
              }}
            >
              จ่าเฉย (JACHOEI)
            </Text>
          ),

          // ✅ BADGE
          tabBarLabel: "Home", 
          tabBarBadge: logsBadge,
          tabBarBadgeStyle: {
            backgroundColor: "#34c759",
            color: "#111",
            fontSize: 10,
            fontWeight: "900",
          },

          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="home-outline"
              size={size}
              color={color}
            />
          ),

           // 🔍 SEARCH BUTTON (ขวาบน)
          headerRight: () => (
             <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="add-outline"
                  size={26}
                  color="#fff"
                  style={{ marginRight: 14 }}
                  onPress={() => {
                    if (!isLoggedIn) {
                      // ❌ ยังไม่ login → เปิด SignIn modal
                      navigation.navigate("SignIn");
                      return;
                    }

                    console.log("auth = ", user);

                    // ✅ login แล้ว → ไปหน้า add
                    navigation.navigate("PostForm"); // หรือ AddPost / CreateScreen
                  }}
                />
                {/* 💬 CHAT (แสดงเฉพาะ login แล้ว) */}
                {isLoggedIn && (
                  <View style={{ marginRight: 14 }}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={22}
                      color="#fff"
                      onPress={() =>  navigation.navigate("Chat") }
                    />

                    {/* 🔴 BADGE */}
                    {/* {chatBadge > 0 && (
                      <View
                        style={{
                          position: "absolute",
                          right: -6,
                          top: -4,
                          minWidth: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: "#ff3b30",
                          alignItems: "center",
                          justifyContent: "center",
                          paddingHorizontal: 4,
                        }}
                      >
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: "900",
                          }}
                        >
                          {chatBadge > 99 ? "99+" : chatBadge}
                        </Text>
                      </View>
                    )} */}
                  </View>
                )}

                <Ionicons
                  name="search-outline"
                  size={22}
                  color="#fff"
                  style={{ marginRight: 16 }}
                  onPress={() => navigation.navigate("BlockedLogsSearch")}
                />
                <HeaderAccountButton />
              </View>
          ),
        })}
      />


       {/* ================= Blocked Logs ================= */}
      <Tab.Screen
        name="BlockedLogs"
        component={BlockedLogsScreen}
        options={({ navigation }) => ({
          title: "Blocked",

          // ✅ BADGE
          tabBarBadge: logsBadge,
          tabBarBadgeStyle: {
            backgroundColor: "#34c759",
            color: "#111",
            fontSize: 10,
            fontWeight: "900",
          },

          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="shield-checkmark-outline"
              size={size}
              color={color}
            />
          ),

          // 🔍 SEARCH BUTTON (ขวาบน)
          headerRight: () => (
             <View style={{ flexDirection: "row", alignItems: "center" }}>
                {/* 🔍 SEARCH */}
                <Ionicons
                  name="search-outline"
                  size={22}
                  color="#fff"
                  style={{ marginRight: 16 }}
                  onPress={() => navigation.navigate("BlockedLogsSearch")}
                />

                {/* ➕ ADD */}
                <Ionicons
                  name="add-circle-outline"
                  size={26}
                  color="#fff"
                  style={{ marginRight: 14 }}
                  onPress={() => {
                    if (!isLoggedIn) {
                      // ❌ ยังไม่ login → เปิด SignIn modal
                      navigation.navigate("SignIn");
                      return;
                    }

                    // ✅ login แล้ว → ไปหน้า add
                    navigation.navigate("PostView"); // หรือ AddPost / CreateScreen
                  }}
                />

                <HeaderAccountButton />
              </View>
          ),
        })}
      />


      {/* ================= เช็กเบอร์ ================= */}
      {/* <Tab.Screen
        name="CheckPhone"
        component={CheckPhoneScreen}
        options={{
          title: "เช็กเบอร์",
          headerLeft: () => (
            <HeaderMenu
              items={[
                { label: "รีเฟรชข้อมูล", onPress: () => console.log("refresh") },
                { label: "ประวัติการค้นหา", onPress: () => console.log("history") },
                { label: "ตั้งค่า", onPress: () => console.log("settings") },
              ]}
            />
          ),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search-outline" size={size} color={color} />
          ),
        }}
      /> */}

      {/* ================= เบอร์ที่บล็อก ================= */}
      <Tab.Screen
        name="BlockedNumbers"
        component={BlockedNumbersScreen}
        options={{
          title: "เบอร์ที่บล็อก",
          headerLeft: () => (
            <HeaderMenu
              items={[
                { label: "เพิ่มเบอร์ใหม่", onPress: () => console.log("add") },
                {
                  label: "ล้างทั้งหมด",
                  destructive: true,
                  onPress: () => console.log("clear"),
                },
              ]}
            />
          ),

          // ✅ BADGE
          tabBarBadge: blockedBadge,
          tabBarBadgeStyle: {
            backgroundColor: "#ff3b30", // แดง
            color: "#fff",
            fontSize: 10,
            fontWeight: "800",
          },

          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ban-outline" size={size} color={color} />
          ),
          headerRight: () => (
             <View style={{ flexDirection: "row", alignItems: "center" }}>
                <HeaderAccountButton />
              </View>
          ),
        }}
      />

     
    </Tab.Navigator>
  );
};
