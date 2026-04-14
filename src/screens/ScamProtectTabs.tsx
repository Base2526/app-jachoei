import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import PhoneCenterLookupTab from "./PhoneCenterLookupTab";
import { HomeScreen } from "./HomeScreen";
import { MoreScreen } from "./MoreScreen";

import { HeaderActionsBar } from "../components/HeaderActionsBar";
import { useAuth } from "../auth/AuthProvider";
import { useGlobalChatStore } from "../store/globalChatStore";
import { useI18n } from "../i18n";

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
  const { width: windowWidth } = useWindowDimensions();
  const { t } = useI18n();
  const { logsCount } = useBadges();
  const { isLoggedIn } = useAuth();
  const isCompactHeader = windowWidth < 360;

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
        headerStyle: {
          backgroundColor: "#0b0f19",
          borderBottomWidth: 1,
          borderBottomColor: "#182235",
        },
        headerTintColor: "#fff",
        headerTitleAlign: "center",
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: "#0b0f19", borderTopColor: "#182235" },
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

          const openSearch = () => goStack("BlockedLogsSearch");
          const openNotifications = () => {
            if (!isLoggedIn) {
              goStack("SignIn");
              return;
            }
            goStack("Notifications" as any);
          };
          const openChat = () => {
            if (!isLoggedIn) {
              goStack("SignIn");
              return;
            }
            goStack("Chat");
          };
          const openCreatePost = () => {
            if (!isLoggedIn) {
              goStack("SignIn");
              return;
            }
            goStack("PostForm");
          };

          return {
            headerTitle: () => null,
            headerLeftContainerStyle: {
              paddingLeft: 0,
            },
            headerRightContainerStyle: {
              paddingRight: 14,
            },
            headerLeft: () => <View style={headerStyles.headerLeftSpacer} />,

            tabBarLabel: t("tabs.home"),
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
              <HeaderActionsBar
                isCompact={isCompactHeader}
                onSearch={openSearch}
                onNotification={openNotifications}
                onChat={openChat}
                notificationBadge={notifBadge}
                chatBadge={chatBadge}
                searchA11y={t("common.search")}
                notificationA11y={t("settings.notifications")}
                chatA11y={t("chat.chats")}
                menuTitle={t("tabs.more")}
                menuCancelLabel={t("common.cancel")}
                menuItems={[
                  {
                    label: t("postForm.title_create"),
                    icon: "add-outline",
                    onPress: openCreatePost,
                  },
                ]}
                showProfile
                showMore
              />
            ),
          };
        }}
      />

      {/* ================= Phone Center ================= */}
      <Tab.Screen
        name="CheckPhone"
        component={PhoneCenterLookupTab}
        options={{
          headerShown: false,
          title: "Phone Center",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call-outline" size={size} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          title: t("tabs.more"),
          tabBarLabel: t("tabs.more"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const headerStyles = StyleSheet.create({
  headerLeftSpacer: {
    width: 0,
  },
});