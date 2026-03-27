import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging, { FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import notifee, { AndroidImportance, EventType } from "@notifee/react-native";
import { gql } from "@apollo/client";

import { client } from "../apollo/client";
import { getCachedDeviceInfo } from "../device/deviceInfo";
import { navigationRef } from "../../App";
import { refreshUnreadChatBadge } from "./badge";

import { getGlobalChatState, useGlobalChatStore } from "../store/globalChatStore";
import { useAuth } from "../auth/AuthProvider";

const STORAGE_PENDING_CHAT_ID = "pending_chat_id";
const STORAGE_ASKED_NOTI_PERMISSION = "asked_noti_permission_v1";

const CHAT_CHANNEL_ID = "chat_messages";

const MUT_REGISTER_PUSH = gql`
  mutation RegisterPushToken($input: RegisterPushTokenInput!) {
    registerPushToken(input: $input)
  }
`;

const MUT_UNREGISTER_PUSH = gql`
  mutation UnregisterPushToken($fcmToken: String!) {
    unregisterPushToken(fcmToken: $fcmToken)
  }
`;

function parseChatIdFromData(data: Record<string, string> | undefined | null) {
  const conversationId = String(data?.conversationId || "").trim();
  if (conversationId) return conversationId;

  // backward compat / alternate keys
  const chatId = String((data as any)?.chat_id || "").trim();
  return chatId || null;
}

async function ensureChatChannel() {
  if (Platform.OS !== "android") return;

  await notifee.createChannel({
    id: CHAT_CHANNEL_ID,
    name: "Chat messages",
    importance: AndroidImportance.HIGH,
    badge: true,
  });
}

async function requestAndroidNotificationPermissionOnce() {
  if (Platform.OS !== "android") return true;
  if (Platform.Version < 33) return true;

  const asked = await AsyncStorage.getItem(STORAGE_ASKED_NOTI_PERMISSION);
  if (asked === "1") {
    const already = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return already;
  }

  await AsyncStorage.setItem(STORAGE_ASKED_NOTI_PERMISSION, "1");

  Alert.alert(
    "Notifications",
    "Enable notifications to receive new chat messages.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Enable",
        onPress: async () => {
          try {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            );
          } catch {
            // ignore
          }
        },
      },
    ]
  );

  return true;
}

async function navigateToChat(chatId: string) {
  const id = String(chatId || "").trim();
  if (!id) return;

  if (!navigationRef.isReady()) {
    await AsyncStorage.setItem(STORAGE_PENDING_CHAT_ID, id);
    return;
  }

  navigationRef.navigate("Chat", { chatId: id } as any);
}

async function handleOpenFromMessage(message: FirebaseMessagingTypes.RemoteMessage) {
  const chatId = parseChatIdFromData(message.data as any);
  if (!chatId) return;

  await AsyncStorage.setItem(STORAGE_PENDING_CHAT_ID, chatId);
  await navigateToChat(chatId);
}

export function FcmWires() {
  const auth = useAuth();
  const isLoggedIn = auth.isLoggedIn;
  const booting = auth.booting;
  const openChatOrSignIn = useCallback(
    async (chatId: string) => {
      const id = String(chatId || "").trim();
      if (!id) return;

      await AsyncStorage.setItem(STORAGE_PENDING_CHAT_ID, id);

      if (!navigationRef.isReady()) return;

      if (!auth.isLoggedIn) {
        navigationRef.navigate("SignIn" as any);
        return;
      }

      await navigateToChat(id);
    },
    [auth.isLoggedIn]
  );


  const setAppFocused = useGlobalChatStore((s) => s.setAppFocused);

  const [registeredToken, setRegisteredToken] = useState<string | null>(null);
  const isReadyForPush = useMemo(() => {
    return Platform.OS === "android" && !booting && isLoggedIn;
  }, [booting, isLoggedIn]);

  // Keep appFocused in zustand for reuse in other logic
  useEffect(() => {
    const onAppState = (st: any) => {
      setAppFocused(st === "active");
    };
    const sub = AppState.addEventListener("change", onAppState);
    onAppState(AppState.currentState);
    return () => sub.remove();
  }, [setAppFocused]);

  // Create notification channel early
  useEffect(() => {
    void ensureChatChannel();
  }, []);

  // Request permission once (Android 13+) when user is logged in
  useEffect(() => {
    if (!isReadyForPush) return;
    void requestAndroidNotificationPermissionOnce();
  }, [isReadyForPush]);

  const registerToken = useCallback(
    async (fcmToken: string) => {
      const token = String(fcmToken || "").trim();
      if (!token) return;

      const device = getCachedDeviceInfo();

      let locale: string | null = null;
      try {
        locale = Intl.DateTimeFormat().resolvedOptions().locale || null;
      } catch {
        locale = null;
      }

      await client
        .mutate({
          mutation: MUT_REGISTER_PUSH,
          variables: {
            input: {
              platform: "android",
              fcmToken: token,
              deviceId: device?.deviceId ?? null,
              appVersion: device?.appVersion ?? null,
              locale,
            },
          },
        })
        .catch(() => {});

      setRegisteredToken(token);
    },
    []
  );

  // FCM token lifecycle
  useEffect(() => {
    if (!isReadyForPush) return;

    let unsubRefresh: null | (() => void) = null;

    (async () => {
      try {
        await messaging().registerDeviceForRemoteMessages();
        const token = await messaging().getToken();
        await registerToken(token);

        unsubRefresh = messaging().onTokenRefresh(async (t: string) => {
          await registerToken(t);
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      if (unsubRefresh) unsubRefresh();
    };
  }, [isReadyForPush, registerToken]);

  // Foreground notifications: show Notifee local notif
  useEffect(() => {
    if (!isReadyForPush) return;

    const unsub = messaging().onMessage(async (msg: FirebaseMessagingTypes.RemoteMessage) => {
      const chatId = parseChatIdFromData(msg.data as any);
      const state = getGlobalChatState();
      const isCurrentRoom = !!chatId && state.currentChatId === chatId;
      const isFocused = state.appFocused;

      // If user is actively reading the same room, skip pop-up notification
      if (isCurrentRoom && isFocused) {
        await refreshUnreadChatBadge();
        return;
      }

      const title = String(msg.notification?.title || "New message");
      const body = String(msg.notification?.body || "");

      await ensureChatChannel();

      await notifee.displayNotification({
        title,
        body,
        android: {
          channelId: CHAT_CHANNEL_ID,
          pressAction: {
            id: "default",
          },
        },
        data: {
          ...(msg.data as any),
        },
      });

      await refreshUnreadChatBadge();
    });

    return () => unsub();
  }, [isReadyForPush]);

  // Handle notification taps (background -> open)
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const unsubOpened = messaging().onNotificationOpenedApp(async (msg: FirebaseMessagingTypes.RemoteMessage) => {
      if (!msg) return;
      const chatId = parseChatIdFromData(msg.data as any);
      if (!chatId) return;
      await openChatOrSignIn(chatId);
    });

    (async () => {
      const initial = await messaging().getInitialNotification().catch(() => null);
      if (initial) {
        const chatId = parseChatIdFromData(initial.data as any);
        if (!chatId) return;
        await openChatOrSignIn(chatId);
      }
    })();

    return () => {
      unsubOpened();
    };
  }, []);

  // Handle Notifee taps (foreground local notifications)
  useEffect(() => {
    const unsub = notifee.onForegroundEvent(async ({ type, detail }: any) => {
      if (type !== EventType.PRESS) return;
      const chatId = parseChatIdFromData((detail.notification?.data as any) || null);
      if (!chatId) return;
      await openChatOrSignIn(chatId);
    });
    return () => unsub();
  }, []);

  // Drain pending deep link after login
  const drainedRef = useRef(false);
  useEffect(() => {
    if (!isReadyForPush) return;
    if (drainedRef.current) return;

    (async () => {
      const pending = await AsyncStorage.getItem(STORAGE_PENDING_CHAT_ID);
      const chatId = String(pending || "").trim();
      if (!chatId) {
        drainedRef.current = true;
        return;
      }

      drainedRef.current = true;
      await AsyncStorage.removeItem(STORAGE_PENDING_CHAT_ID);
      await navigateToChat(chatId);

      await refreshUnreadChatBadge();
    })();
  }, [isReadyForPush]);

  // Keep badge in sync when app comes to foreground
  useEffect(() => {
    if (!isReadyForPush) return;

    const sub = AppState.addEventListener("change", async (st) => {
      if (st !== "active") return;
      await refreshUnreadChatBadge();
    });

    return () => sub.remove();
  }, [isReadyForPush]);

  // Best-effort unregister when user logs out (token becomes false)
  useEffect(() => {
    if (isLoggedIn) return;
    if (!registeredToken) return;

    client
      .mutate({
        mutation: MUT_UNREGISTER_PUSH,
        variables: { fcmToken: registeredToken },
      })
      .catch(() => {});
  }, [isLoggedIn, registeredToken]);

  return null;
}
