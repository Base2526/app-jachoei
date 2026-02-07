import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Text } from "react-native";

import { CheckPhoneScreen } from "./CheckPhoneScreen";
import { BlockedNumbersScreen } from "./BlockedNumbersScreen";
import { BlockedLogsScreen } from "./BlockedLogsScreen";
import { HeaderMenu } from "../components/HeaderMenu";

import { HomeScreen } from "./HomeScreen";

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
            <Ionicons
              name="search-outline"
              size={22}
              color="#fff"
              style={{ marginRight: 14 }}
              onPress={() => navigation.navigate("BlockedLogsSearch")}
            />
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
            <Ionicons
              name="search-outline"
              size={22}
              color="#fff"
              style={{ marginRight: 14 }}
              onPress={() => navigation.navigate("BlockedLogsSearch")}
            />
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
        }}
      />

     
    </Tab.Navigator>
  );
};
