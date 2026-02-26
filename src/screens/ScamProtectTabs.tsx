import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Text, View } from "react-native";

import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import PhoneCenterLookupTab from "./PhoneCenterLookupTab";
import { HomeScreen } from "./HomeScreen";
import SafetyCenterMyListsTab from "./SafetyCenterMyListsTab";

import { HeaderAccountButton } from "../components/HeaderAccountButton";
import { useAuth } from "../auth/AuthProvider";
import { useGlobalChatStore } from "../store/globalChatStore";

import { client } from "../apollo/client";
import { gql } from "@apollo/client";
import type { TabsParamList, RootStackParamList } from "../navigation/types";

// ===== GraphQL =====
const Q_UNREAD_NOTIFICATION_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

const Tab = createBottomTabNavigator<TabsParamList>();

function useBadges() {
  const blockedCount = 12;
  const logsCount = 0;
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

  // --- Notification unread count state ---
  const [notifUnreadCount, setNotifUnreadCount] = React.useState(0);

  React.useEffect(() => {
    let sub: any = undefined;
    let observable: any = undefined;

    if (isLoggedIn) {
      observable = client.watchQuery({
        query: Q_UNREAD_NOTIFICATION_COUNT,
        fetchPolicy: "cache-and-network",
      });
      sub = observable.subscribe({
        next: (result: any) => {
          setNotifUnreadCount(result?.data?.myUnreadNotificationCount ?? 0);
        },
        error: () => {
          setNotifUnreadCount(0);
        },
      });
    } else {
      setNotifUnreadCount(0);
    }

    return () => {
      if (sub) sub.unsubscribe?.();
      if (observable) observable.stopPolling?.();
    };
  }, [isLoggedIn]);

  const chatBadge = useMemo<undefined | number | string>(() => {
    if (!isLoggedIn) return undefined;
    if (!totalUnread || totalUnread <= 0) return undefined;
    if (totalUnread > 99) return "99+";
    return totalUnread;
  }, [isLoggedIn, totalUnread]);

  const notifBadge = useMemo<undefined | number | string>(() => {
    if (!isLoggedIn) return undefined;
    if (!notifUnreadCount || notifUnreadCount <= 0) return undefined;
    if (notifUnreadCount > 99) return "99+";
    return notifUnreadCount;
  }, [isLoggedIn, notifUnreadCount]);

  const blockedBadge = useMemo<undefined | number | string>(() => {
    if (blockedCount <= 0) return undefined;
    if (blockedCount > 99) return "99+";
    return blockedCount;
  }, [blockedCount]);

  // ✅ ถ้า BlockedLogs ต้อง auth เท่านั้น → ซ่อน badge เมื่อไม่ login (optional)
  const logsBadge = useMemo<undefined | number | string>(() => {
    if (!isLoggedIn) return undefined;
    if (logsCount <= 0) return undefined;
    if (logsCount > 99) return "99+";
    return logsCount;
  }, [isLoggedIn, logsCount]);

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
          const tabNav = navigation as BottomTabNavigationProp<TabsParamList>;
          const stackNav =
            tabNav.getParent<NativeStackNavigationProp<RootStackParamList>>();

          const goStack = <T extends keyof RootStackParamList>(
            name: T,
            params?: RootStackParamList[T]
          ) => {
            if (!stackNav) return;
            // @ts-expect-error params optional depending on route
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
                {/* ➕ ADD */}
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

                {/* 🔔 NOTIFICATIONS + BADGE */}
                <View style={{ marginRight: 14 }}>
                  <Ionicons
                    name="notifications-outline"
                    size={22}
                    color="#fff"
                    onPress={() => {
                      if (!isLoggedIn) {
                        goStack("SignIn");
                        return;
                      }
                      // ✅ ปรับชื่อ route ให้ตรง RootStackParamList ของคุณ
                      goStack("Notifications" as any);
                    }}
                  />
                  {!!notifBadge && (
                    <View
                      style={{
                        position: "absolute",
                        right: -8,
                        top: -6,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        backgroundColor: "#34c759",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: "#111",
                          fontSize: 10,
                          fontWeight: "900",
                        }}
                      >
                        {notifBadge}
                      </Text>
                    </View>
                  )}
                </View>

                {/* 🔍 SEARCH */}
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
        component={PhoneCenterLookupTab}
        options={{
          title: "ตรวจเบอร์",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call-outline" size={size} color={color} />
          ),
        }}
      />

      {/* ================= Blocked Logs (AUTH ONLY) ================= */}
      {isLoggedIn ? (
        <Tab.Screen
          name="BlockedLogs"
          component={SafetyCenterMyListsTab}
          options={({ navigation }) => {
            const tabNav =
              navigation as BottomTabNavigationProp<TabsParamList>;
            const stackNav =
              tabNav.getParent<NativeStackNavigationProp<RootStackParamList>>();

            const goStack = <T extends keyof RootStackParamList>(
              name: T,
              params?: RootStackParamList[T]
            ) => {
              if (!stackNav) return;
              // @ts-expect-error params optional depending on route
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
            };
          }}
        />
      ) : null}
    </Tab.Navigator>
  );
};