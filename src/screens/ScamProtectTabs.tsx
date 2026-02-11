import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Text, View } from "react-native";

import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { CheckPhoneScreen } from "./CheckPhoneScreen";
import { BlockedNumbersScreen } from "./BlockedNumbersScreen";
import { BlockedLogsScreen } from "./BlockedLogsScreen";
import { HomeScreen } from "./HomeScreen";

import { HeaderMenu } from "../components/HeaderMenu";
import { HeaderAccountButton } from "../components/HeaderAccountButton";

import { useAuth } from "../auth/AuthProvider";
import { useGlobalChatStore } from "../store/globalChatStore";

import type { TabsParamList, RootStackParamList } from "../navigation/types";

const Tab = createBottomTabNavigator<TabsParamList>();

function useBadges() {
  const blockedCount = 12;
  const logsCount = 3;
  return { blockedCount, logsCount };
}

export const ScamProtectTabs: React.FC = () => {
  const { blockedCount, logsCount } = useBadges();
  const { isLoggedIn } = useAuth();

  const totalUnread = useGlobalChatStore((s: any) =>
    Object.values(s.unreadByChat || {}).reduce(
      (sum: number, n: any) => sum + (n || 0),
      0
    )
  );

  const chatBadge = useMemo<undefined | number | string>(() => {
    if (!isLoggedIn) return undefined;
    if (!totalUnread || totalUnread <= 0) return undefined;
    if (totalUnread > 99) return "99+";
    return totalUnread;
  }, [isLoggedIn, totalUnread]);

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
        tabBarStyle: { backgroundColor: "#111", borderTopColor: "#222" },
        tabBarActiveTintColor: "#1e90ff",
        tabBarInactiveTintColor: "#888",
      }}
    >
      {/* ================= Home ================= */}
      <Tab.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={({ navigation }) => {
          // ✅ navigation ตรงนี้เป็นของ Tab
          const tabNav = navigation as BottomTabNavigationProp<TabsParamList>;

          // ✅ เอา parent (Stack) มาจาก Tab
          const stackNav =
            tabNav.getParent<NativeStackNavigationProp<RootStackParamList>>();

          const goStack = <T extends keyof RootStackParamList>(
            name: T,
            params?: RootStackParamList[T]
          ) => {
            if (!stackNav) return;
            // @ts-expect-error: params optional depending on route
            stackNav.navigate(name, params);
          };

          return {
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

            tabBarLabel: "Home",
            tabBarBadge: logsBadge,
            tabBarBadgeStyle: {
              backgroundColor: "#34c759",
              color: "#111",
              fontSize: 10,
              fontWeight: "900",
            },
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),

            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {/* ➕ ADD (ไป PostForm ถ้า login แล้ว) */}
                <Ionicons
                  name="add-outline"
                  size={26}
                  color="#fff"
                  style={{ marginRight: 14 }}
                  onPress={() => {
                    if (!isLoggedIn) {
                      goStack("SignIn");
                      return;
                    }
                    goStack("PostForm");
                  }}
                />

                {/* 💬 CHAT + BADGE */}
                {isLoggedIn && (
                  <View style={{ marginRight: 14 }}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={22}
                      color="#fff"
                      onPress={() => goStack("Chat", { to: "support" })}
                    />

                    {!!chatBadge && (
                      <View
                        style={{
                          position: "absolute",
                          right: -8,
                          top: -6,
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
                          {chatBadge}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 🔍 SEARCH (Stack screen) */}
                <Ionicons
                  name="search-outline"
                  size={22}
                  color="#fff"
                  style={{ marginRight: 16 }}
                  onPress={() => goStack("BlockedLogsSearch")}
                />

                <HeaderAccountButton />
              </View>
            ),
          };
        }}
      />

      {/* ================= Check Phone ================= */}
      <Tab.Screen
        name="CheckPhone"
        component={CheckPhoneScreen}
        options={{
          title: "ตรวจเบอร์",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call-outline" size={size} color={color} />
          ),
        }}
      />

      {/* ================= Blocked Logs ================= */}
      <Tab.Screen
        name="BlockedLogs"
        component={BlockedLogsScreen}
        options={({ navigation }) => {
          const tabNav = navigation as BottomTabNavigationProp<TabsParamList>;
          const stackNav =
            tabNav.getParent<NativeStackNavigationProp<RootStackParamList>>();

          const goStack = <T extends keyof RootStackParamList>(
            name: T,
            params?: RootStackParamList[T]
          ) => {
            if (!stackNav) return;
            // @ts-expect-error: params optional depending on route
            stackNav.navigate(name, params);
          };

          return {
            title: "Blocked",
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
            headerRight: () => (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="search-outline"
                  size={22}
                  color="#fff"
                  style={{ marginRight: 16 }}
                  onPress={() => goStack("BlockedLogsSearch")}
                />

                <Ionicons
                  name="add-circle-outline"
                  size={26}
                  color="#fff"
                  style={{ marginRight: 14 }}
                  onPress={() => {
                    if (!isLoggedIn) {
                      goStack("SignIn");
                      return;
                    }
                    goStack("PostForm");
                  }}
                />

                <HeaderAccountButton />
              </View>
            ),
          };
        }}
      />

      {/* ================= Blocked Numbers ================= */}
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
          tabBarBadge: blockedBadge,
          tabBarBadgeStyle: {
            backgroundColor: "#ff3b30",
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
