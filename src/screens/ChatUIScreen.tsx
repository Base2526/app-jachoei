// src/screens/ChatScreen.tsx
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Keyboard,
  Platform,
  ToastAndroid,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Clipboard from "@react-native-clipboard/clipboard";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { client } from "../apollo/client";
import SendMessageSection, { UploadImage } from "../components/SendMessageSection";
import { ENV } from "../config/env";
import { refreshUnreadChatBadge } from "../notifications/badge";
import { useI18n } from "../i18n";

// ✅ Zustand global unread/currentChat sync (RN)
import { useGlobalChatStore } from "../store/globalChatStore";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

/** =========================
 * GraphQL
 * ========================= */
const MESSAGE_FIELDS = gql`
  fragment MessageFields on Message {
    id
    chat_id
    text
    reply_to_id

    reply_to {
      id
      text
      images {
        id
        url
        file_id
        mime
      }
      sender {
        id
        name
      }
    }

    created_at
    sender {
      id
      name
      avatar
    }

    myReceipt {
      deliveredAt
      isRead
      readAt
    }

    images {
      id
      url
      mime
      file_id
    }

    readersCount
    deleted_at
    is_deleted
  }
`;

const Q_ME = gql`
  query {
    me {
      id
      name
    }
  }
`;

const Q_CHATS = gql`
  query {
    myChats {
      id
      name
      is_group
      created_at
      created_by {
        id
        name
        avatar
      }
      members {
        id
        name
        avatar
      }
      last_message_at
      last_message {
        id
        text
        created_at
        sender {
          id
          name
          avatar
        }
        images {
          id
          url
          file_id
          mime
        }
      }
    }
  }
`;

const Q_MSGS_CONNECTION = gql`
  query ($chat_id: ID!, $limit: Int, $cursor: String) {
    messagesConnection(chat_id: $chat_id, limit: $limit, cursor: $cursor) {
      items {
        ...MessageFields
      }
      nextCursor
      hasMore
    }
  }
  ${MESSAGE_FIELDS}
`;

const Q_MY_CHAT_SETTINGS = gql`
  query ($chat_id: ID!) {
    myChatSettings(chat_id: $chat_id) {
      is_muted
      notifications_enabled
    }
  }
`;

const MUT_SEND = gql`
  mutation (
    $chat_id: ID!
    $text: String!
    $to_user_ids: [ID!]!
    $images: [Upload!]
    $reply_to_id: ID
    $client_message_id: String
  ) {
    sendMessage(
      chat_id: $chat_id
      text: $text
      to_user_ids: $to_user_ids
      images: $images
      reply_to_id: $reply_to_id
      client_message_id: $client_message_id
    ) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const MUT_MARK_READ = gql`
  mutation ($message_id: ID!) {
    markMessageRead(message_id: $message_id)
  }
`;

const MUT_MARK_UPTO = gql`
  mutation ($chat_id: ID!, $cursor: String!) {
    markChatReadUpTo(chat_id: $chat_id, cursor: $cursor)
  }
`;

const MUT_DELETE_MSG = gql`
  mutation ($message_id: ID!) {
    deleteMessage(message_id: $message_id)
  }
`;

const MUT_CREATE_CHAT = gql`
  mutation ($name: String, $isGroup: Boolean!, $memberIds: [ID!]!) {
    createChat(name: $name, isGroup: $isGroup, memberIds: $memberIds) {
      id
    }
  }
`;

const MUT_UPDATE_MY_CHAT_SETTINGS = gql`
  mutation (
    $chat_id: ID!
    $is_muted: Boolean
    $notifications_enabled: Boolean
  ) {
    updateMyChatSettings(
      chat_id: $chat_id
      is_muted: $is_muted
      notifications_enabled: $notifications_enabled
    ) {
      is_muted
      notifications_enabled
    }
  }
`;

const SUB_ADDED = gql`
  subscription ($chat_id: ID!) {
    messageAdded(chat_id: $chat_id) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const SUB_DELETED = gql`
  subscription ($chat_id: ID!) {
    messageDeleted(chat_id: $chat_id)
  }
`;

/** =========================
 * Types
 * ========================= */
type Me = { id: string; name?: string | null };

type ChatMember = { id: string; name?: string | null; avatar?: string | null };

type Chat = {
  id: string;
  name?: string | null;
  is_group?: boolean | null;
  members?: ChatMember[] | null;
  last_message_at?: string | null;
  last_message?: any | null;
};

type MsgImage = {
  id?: string;
  url?: string | null;
  file_id?: string | null;
  mime?: string | null;
};

type Message = {
  id: string;
  chat_id: string;
  text?: string | null;
  created_at: string;
  sender?: { id: string; name?: string | null; avatar?: string | null } | null;
  images?: MsgImage[] | null;
  reply_to?: any | null;
  reply_to_id?: string | null;
  myReceipt?: any | null;
  readersCount?: number | null;
};

type ChatSettings = {
  is_muted: boolean;
  notifications_enabled: boolean;
};

type MessageConnection = {
  items: Message[];
  nextCursor?: string | null;
  hasMore: boolean;
};

type MessageTextPart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

/** =========================
 * Helpers
 * ========================= */
const PAGE_SIZE = 30;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi;
const TRAILING_PUNCT_RE = /[),.!?;:\]\}]+$/;

function getInitial(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function safeDate(ts: any) {
  const n = Number(ts);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(ts);
  return d;
}

function formatTime(ts: any) {
  const d = safeDate(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getImgSrc(img: any) {
  if (img?.file_id) return `${ENV.apiBase}/api/files/${img.file_id}`;
  return img?.url || "";
}

function normalizeExternalUrl(url?: string | null) {
  if (!url) return "";
  const trimmed = String(url)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if (!trimmed) return "";

  const unwrapped = trimmed
    .replace(/^[\(<\[\{"'`]+/, "")
    .replace(/[\)>\]\}"'`]+$/, "");

  const clean = unwrapped.replace(TRAILING_PUNCT_RE, "");
  if (!clean) return "";

  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^www\./i.test(clean)) return `https://${clean}`;

  return "";
}

function displayUrlForWrap(url: string) {
  return url.replace(/([/?&=#._-])/g, "$1\u200B");
}

function parseMessageTextParts(text?: string | null): MessageTextPart[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];

  const parts: MessageTextPart[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(URL_RE)) {
    const start = match.index ?? -1;
    const full = match[0] ?? "";
    if (start < 0 || !full) continue;

    if (start > lastIndex) {
      parts.push({ type: "text", value: raw.slice(lastIndex, start) });
    }

    let linkText = full;
    let trailing = "";
    const punct = full.match(TRAILING_PUNCT_RE)?.[0] ?? "";
    if (punct && punct.length < full.length) {
      linkText = full.slice(0, full.length - punct.length);
      trailing = punct;
    }

    const href = normalizeExternalUrl(linkText);
    if (href) {
      parts.push({ type: "link", value: linkText, href });
    } else {
      parts.push({ type: "text", value: full });
    }

    if (trailing) {
      parts.push({ type: "text", value: trailing });
    }

    lastIndex = start + full.length;
  }

  if (lastIndex < raw.length) {
    parts.push({ type: "text", value: raw.slice(lastIndex) });
  }

  return parts;
}

/** =========================
 * Screen
 * ========================= */
export default function ChatScreen({ navigation, route }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const composerBottomPad = Platform.OS === "android" ? Math.max(insets.bottom, 8) : 0;

  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  const toParamRaw = route.params?.to;
  const toParam = String(toParamRaw ?? "").trim() || null;
  const handledToRef = useRef<string | null>(null);

  const chatIdParamRaw = (route.params as any)?.chatId;
  const chatIdParam = String(chatIdParamRaw ?? "").trim() || null;
  const handledChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    handledToRef.current = null;
  }, [toParam]);

  useEffect(() => {
    handledChatIdRef.current = null;
  }, [chatIdParam]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [hasNextPage, setHasNextPage] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [replyTarget, setReplyTarget] = useState<any | null>(null);

  const [chatsModalOpen, setChatsModalOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    is_muted: false,
    notifications_enabled: true,
  });
  const [chatSettingsBusy, setChatSettingsBusy] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [isMessageMenuVisible, setIsMessageMenuVisible] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);

  const [composerHeight, setComposerHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const listRef = useRef<FlatList<Message> | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const isNearBottomRef = useRef(true);
  const lastScrollTickRef = useRef(0);
  const lastMsgCountRef = useRef(0);
  const forceScrollOnNextAppendRef = useRef(false);

  const subAddedRef = useRef<any>(null);
  const subDeletedRef = useRef<any>(null);
  const loadMoreLockRef = useRef(false);
  const onEndReachedLockRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(null);

  const meId = me?.id;

  useEffect(() => {
    activeChatIdRef.current = sel;
  }, [sel]);

  // Keep FAB position correct when keyboard opens/closes.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvt as any, (e: any) => {
      const h = e?.endCoordinates?.height;
      setKeyboardHeight(Number.isFinite(h) ? Math.max(0, Number(h)) : 0);
    });
    const hideSub = Keyboard.addListener(hideEvt as any, () => setKeyboardHeight(0));

    return () => {
      try {
        showSub.remove();
      } catch {}
      try {
        hideSub.remove();
      } catch {}
    };
  }, []);

  // ✅ Zustand sync (เหมือน web)
  const setCurrentChat = useGlobalChatStore((s: any) => s.setCurrentChat);
  const clearUnread = useGlobalChatStore((s: any) => s.clearUnread);

  useEffect(() => {
    // cleanup: ออกจากหน้า chat ให้ clear currentChat
    return () => {
      setCurrentChat(null);
    };
  }, [setCurrentChat]);

  const selectedChat = useMemo(
    () => chats.find((c) => c.id === sel) ?? null,
    [chats, sel]
  );

  const partner = useMemo(() => {
    if (!selectedChat || selectedChat?.is_group) return null;
    return (selectedChat.members ?? []).find((m) => m.id !== meId) ?? null;
  }, [selectedChat, meId]);

  const title = useMemo(() => {
    if (!selectedChat) return t("app.chat_title");
    if (selectedChat.is_group) return selectedChat.name?.trim() || t("chat.group_chat");
    return partner?.name || t("app.chat_title");
  }, [selectedChat, partner, t]);

  const subtitle = useMemo(() => {
    if (!selectedChat) return "";
    if (selectedChat.is_group) {
      return (selectedChat.members ?? [])
        .filter((m) => m.id !== meId)
        .slice(0, 3)
        .map((m) => m.name)
        .filter(Boolean)
        .join(", ");
    }
    return partner?.id ? t("chat.tap_to_view_profile") : "";
  }, [selectedChat, meId, partner?.id, t]);

  /** ===== load me + chats ===== */
  const loadMeAndChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const meRes = await client.query<{ me: Me }>({
        query: Q_ME,
        fetchPolicy: "network-only",
      });
      setMe(meRes.data?.me ?? null);

      const meIdLocal = String(meRes.data?.me?.id ?? "").trim() || null;

      const chatsRes = await client.query<{ myChats: Chat[] }>({
        query: Q_CHATS,
        fetchPolicy: "network-only",
      });

      const list = chatsRes.data?.myChats ?? [];
      const sorted = [...list].sort((a, b) => {
        const at = a.last_message_at ? safeDate(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? safeDate(b.last_message_at).getTime() : 0;
        return bt - at;
      });

      setChats(sorted);

      // Open a specific conversation (deep link / push) by chat id
      if (chatIdParam && handledChatIdRef.current !== chatIdParam) {
        handledChatIdRef.current = chatIdParam;
        openChatById(chatIdParam);
        return;
      }

      const fallbackToUserId = "support";

      const openToChat = async (toUserId: string) => {
        const toUser = String(toUserId ?? "").trim();
        if (!toUser || !meIdLocal) return;
        if (toUser === meIdLocal) return;
        if (handledToRef.current === toUser) return;

        const chatList = sorted;
        const existing = chatList.find((c) => {
          if (c?.is_group) return false;
          const memberIds = (c.members ?? []).map((m) => m?.id).filter(Boolean);
          const hasMe = memberIds.includes(meIdLocal);
          const hasTo = memberIds.includes(toUser);
          return hasMe && hasTo;
        });

        handledToRef.current = toUser;

        if (existing?.id) {
          openChatById(existing.id);
          return;
        }

        try {
          const createRes = await client.mutate<{ createChat: { id: string } }>({
            mutation: MUT_CREATE_CHAT,
            variables: { name: null, isGroup: false, memberIds: [toUser] },
          });
          const newId = createRes.data?.createChat?.id;
          if (!newId) {
            Alert.alert(t("app.chat_title"), t("chat.cannot_create_chat"));
            return;
          }

          // refresh chat list then open
          const chatsRes2 = await client.query<{ myChats: Chat[] }>({
            query: Q_CHATS,
            fetchPolicy: "network-only",
          });
          const list2 = chatsRes2.data?.myChats ?? [];
          const sorted2 = [...list2].sort((a, b) => {
            const at = a.last_message_at ? safeDate(a.last_message_at).getTime() : 0;
            const bt = b.last_message_at ? safeDate(b.last_message_at).getTime() : 0;
            return bt - at;
          });
          setChats(sorted2);

          openChatById(newId);
        } catch (e: any) {
          Alert.alert(t("app.chat_title"), e?.message || t("chat.cannot_create_chat"));
        }
      };

      if (toParam) {
        await openToChat(toParam);
      } else if (!sel && sorted.length) {
        openChatById(sorted[0].id);
      } else if (!sel && sorted.length === 0) {
        await openToChat(fallbackToUserId);
      }
    } catch (e: any) {
      Alert.alert(t("chat.load_error"), e?.message || t("common.unknown_error"));
    } finally {
      setLoadingChats(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, toParam, chatIdParam]);

  useEffect(() => {
    loadMeAndChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== load messages for chat ===== */
  const loadMessages = useCallback(
    async (chatId: string, mode: "replace" | "append", cursor?: string | null) => {
      if (!chatId) return;
      if (mode === "append" && loadMoreLockRef.current) return;

      if (mode === "replace") setLoadingMsgs(true);
      else {
        loadMoreLockRef.current = true;
        setLoadingMore(true);
      }

      try {
        const res = await client.query<{ messagesConnection: MessageConnection }>({
          query: Q_MSGS_CONNECTION,
          variables: { chat_id: chatId, limit: PAGE_SIZE, cursor: cursor ?? null },
          fetchPolicy: "network-only",
        });

        if (activeChatIdRef.current !== chatId) return;

        const page = res.data?.messagesConnection;
        const got = page?.items ?? [];
        const sorted = [...got].sort(
          (a, b) =>
            safeDate(a.created_at).getTime() - safeDate(b.created_at).getTime()
        );
        setHasNextPage(!!page?.hasMore);
        setNextCursor(page?.nextCursor ?? null);

        if (mode === "replace") {
          setMessages(sorted);
        } else {
          setMessages((prev) => {
            const map = new Map<string, Message>();
            for (const m of [...sorted, ...prev]) map.set(m.id, m);
            return Array.from(map.values()).sort(
              (a, b) =>
                safeDate(a.created_at).getTime() -
                safeDate(b.created_at).getTime()
            );
          });
        }

        const latest = sorted[sorted.length - 1];
        if (mode === "replace" && latest?.created_at) {
          client
            .mutate({
              mutation: MUT_MARK_UPTO,
              variables: { chat_id: chatId, cursor: latest.created_at },
            })
            .then(() => refreshUnreadChatBadge())
            .catch(() => {});
        }
      } catch (e: any) {
        Alert.alert(t("chat.load_messages_error"), e?.message || t("common.unknown_error"));
      } finally {
        if (mode === "replace") setLoadingMsgs(false);
        else {
          setLoadingMore(false);
          loadMoreLockRef.current = false;
        }
      }
    },
    [t]
  );

  const loadChatSettings = useCallback(async (chatId: string) => {
    if (!chatId) return;
    try {
      const res = await client.query<{ myChatSettings: ChatSettings }>({
        query: Q_MY_CHAT_SETTINGS,
        variables: { chat_id: chatId },
        fetchPolicy: "network-only",
      });

      const got = res.data?.myChatSettings;
      setChatSettings({
        is_muted: !!got?.is_muted,
        notifications_enabled: got?.notifications_enabled !== false,
      });
    } catch {
      setChatSettings({ is_muted: false, notifications_enabled: true });
    }
  }, []);

  /** ===== open chat ===== */
  const openChatById = useCallback(
    async (chatId: string) => {
      setSel(chatId);
      setChatsModalOpen(false);

      setCurrentChat(chatId);
      clearUnread(chatId);

      setReplyTarget(null);
      setText("");
      setHasNextPage(true);
      setNextCursor(null);
      activeChatIdRef.current = chatId;

      await loadMessages(chatId, "replace");
    },
    [loadMessages, setCurrentChat, clearUnread]
  );

  /** ===== subscribe when sel changes ===== */
  useEffect(() => {
    if (!sel) return;

    setReplyTarget(null);
    setText("");
    setHasNextPage(true);
    setNextCursor(null);

    setCurrentChat(sel);
    clearUnread(sel);

    loadChatSettings(sel);
    loadMessages(sel, "replace");

    // Reset scroll state per chat
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    lastMsgCountRef.current = 0;

    try {
      subAddedRef.current?.unsubscribe?.();
    } catch {}
    try {
      subDeletedRef.current?.unsubscribe?.();
    } catch {}

    subAddedRef.current = client
      .subscribe<{ messageAdded: Message }>({
        query: SUB_ADDED,
        variables: { chat_id: sel },
      })
      .subscribe({
        next: (ev) => {
          const m = ev.data?.messageAdded;
          if (!m) return;

          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, m].sort(
              (a, b) =>
                safeDate(a.created_at).getTime() -
                safeDate(b.created_at).getTime()
            );
          });

          setChats((prev) =>
            prev
              .map((c) => {
                if (c.id !== m.chat_id) return c;
                return {
                  ...c,
                  last_message: {
                    id: m.id,
                    text: m.text,
                    created_at: m.created_at,
                    sender: m.sender,
                    images: m.images ?? [],
                  },
                  last_message_at: m.created_at,
                };
              })
              .sort((a, b) => {
                const at = a.last_message_at ? safeDate(a.last_message_at).getTime() : 0;
                const bt = b.last_message_at ? safeDate(b.last_message_at).getTime() : 0;
                return bt - at;
              })
          );

          if (m.chat_id === sel) {
            client
              .mutate({
                mutation: MUT_MARK_READ,
                variables: { message_id: m.id },
              })
              .catch(() => {});
          }
        },
        error: (err) => console.warn("[SUB_ADDED] error", err),
      });

    subDeletedRef.current = client
      .subscribe<{ messageDeleted: string }>({
        query: SUB_DELETED,
        variables: { chat_id: sel },
      })
      .subscribe({
        next: (ev) => {
          const deletedId = ev.data?.messageDeleted;
          if (!deletedId) return;
          setMessages((prev) => prev.filter((x) => x.id !== deletedId));
        },
        error: (err) => console.warn("[SUB_DELETED] error", err),
      });

    return () => {
      try {
        subAddedRef.current?.unsubscribe?.();
      } catch {}
      try {
        subDeletedRef.current?.unsubscribe?.();
      } catch {}
    };
  }, [sel, loadMessages, loadChatSettings, setCurrentChat, clearUnread]);

  // Auto-scroll to bottom on new messages ONLY if user is already near bottom.
  useEffect(() => {
    const count = messages.length;
    const prev = lastMsgCountRef.current;
    lastMsgCountRef.current = count;

    if (!sel) return;
    if (count <= 0 || count <= prev) return;
    if (!isNearBottomRef.current) return;

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, [messages.length, sel]);

  const scrollToBottom = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const scrollToBottomSoon = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);

  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const now = Date.now();
    if (now - lastScrollTickRef.current < 80) return;
    lastScrollTickRef.current = now;

    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    // FlatList is inverted, so "bottom" (latest message) is near offset.y ~= 0
    const bottomThreshold = 24;
    const isAtBottom = contentOffset.y <= bottomThreshold;

    const nearBottomForAuto = contentOffset.y <= 120;
    isNearBottomRef.current = nearBottomForAuto;

    setShowScrollToBottom(!isAtBottom);
  }, []);

  /** ===== load older (pagination) ===== */
  const loadOlder = useCallback(async () => {
    if (!sel) return;
    if (loadingMore || loadingMsgs) return;
    if (!hasNextPage) return;
    if (!nextCursor) return;

    await loadMessages(sel, "append", nextCursor);
  }, [sel, loadingMore, loadingMsgs, hasNextPage, nextCursor, loadMessages]);

  /** ===== send message ===== */
  const onSend = useCallback(
    async (args: {
      chat_id: string;
      text: string;
      to_user_ids: string[];
      images?: UploadImage[];
      reply_to_id?: string | null;
      client_message_id?: string | null;
    }) => {
      // User explicitly sent a message — always bring them to the latest message.
      forceScrollOnNextAppendRef.current = true;
      const uploadFiles = (args.images ?? []).map((f) => ({
        uri: f.uri,
        name: f.name || `img-${Date.now()}.jpg`,
        type: f.type || "image/jpeg",
      }));

      const res = await client.mutate<{ sendMessage: Message }>({
        mutation: MUT_SEND,
        variables: {
          chat_id: args.chat_id,
          text: args.text,
          to_user_ids: args.to_user_ids,
          images: uploadFiles.length ? uploadFiles : null,
          reply_to_id: args.reply_to_id ?? null,
          client_message_id: args.client_message_id ?? null,
        },
      });

      const newMsg = res.data?.sendMessage;
      if (!newMsg) return;

      setMessages((prev) => {
        if (prev.some((x) => x.id === newMsg.id)) return prev;
        return [...prev, newMsg].sort(
          (a, b) =>
            safeDate(a.created_at).getTime() -
            safeDate(b.created_at).getTime()
        );
      });

      // Ensure the freshly-sent message is visible immediately.
      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      scrollToBottomSoon(true);

      if (sel && newMsg.created_at) {
        client
          .mutate({
            mutation: MUT_MARK_UPTO,
            variables: { chat_id: sel, cursor: newMsg.created_at },
          })
          .catch(() => {});
      }
    },
    [sel, scrollToBottomSoon]
  );

  /** ===== delete message ===== */
  const onDeleteMessage = useCallback(async (m: Message) => {
    try {
      await client.mutate({
        mutation: MUT_DELETE_MSG,
        variables: { message_id: m.id },
      });
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e: any) {
      console.warn("[Chat] delete failed", e?.message || e);
      if (Platform.OS === "android") {
        ToastAndroid.show(t("chat.delete_failed"), ToastAndroid.SHORT);
      }
    }
  }, [t]);

  /** ===== image preview ===== */
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const handleRefreshChat = useCallback(async () => {
    if (!sel) {
      await loadMeAndChats();
      return;
    }
    await Promise.all([loadMessages(sel, "replace"), loadMeAndChats()]);
  }, [sel, loadMeAndChats, loadMessages]);

  const handleToggleMuteChat = useCallback(async () => {
    if (!sel || chatSettingsBusy) return;
    setChatSettingsBusy(true);
    try {
      const res = await client.mutate<{ updateMyChatSettings: ChatSettings }>({
        mutation: MUT_UPDATE_MY_CHAT_SETTINGS,
        variables: {
          chat_id: sel,
          is_muted: !chatSettings.is_muted,
          notifications_enabled: null,
        },
      });
      const next = res.data?.updateMyChatSettings;
      if (next) {
        setChatSettings({
          is_muted: !!next.is_muted,
          notifications_enabled: next.notifications_enabled !== false,
        });
      }
    } catch (e: any) {
      Alert.alert(t("app.chat_title"), e?.message || t("chat.mute"));
      await loadChatSettings(sel);
    } finally {
      setChatSettingsBusy(false);
    }
  }, [sel, chatSettingsBusy, chatSettings.is_muted, loadChatSettings, t]);

  const handleToggleChatNotifications = useCallback(async () => {
    if (!sel || chatSettingsBusy) return;
    setChatSettingsBusy(true);
    try {
      const res = await client.mutate<{ updateMyChatSettings: ChatSettings }>({
        mutation: MUT_UPDATE_MY_CHAT_SETTINGS,
        variables: {
          chat_id: sel,
          is_muted: null,
          notifications_enabled: !chatSettings.notifications_enabled,
        },
      });
      const next = res.data?.updateMyChatSettings;
      if (next) {
        setChatSettings({
          is_muted: !!next.is_muted,
          notifications_enabled: next.notifications_enabled !== false,
        });
      }
    } catch (e: any) {
      Alert.alert(t("app.chat_title"), e?.message || t("chat.turn_off_notifications"));
      await loadChatSettings(sel);
    } finally {
      setChatSettingsBusy(false);
    }
  }, [sel, chatSettingsBusy, chatSettings.notifications_enabled, loadChatSettings, t]);

  const handleOpenChatMenu = useCallback(() => {
    setIsMenuVisible(true);
  }, []);

  const handleCloseChatMenu = useCallback(() => {
    setIsMenuVisible(false);
  }, []);

  const runMenuAction = useCallback((action: () => Promise<void> | void) => {
    setIsMenuVisible(false);
    setTimeout(() => {
      void action();
    }, 10);
  }, []);

  const openMenu = useCallback((message: Message) => {
    setSelectedMessage(message);
    setIsMessageMenuVisible(true);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMessageMenuVisible(false);
    setSelectedMessage(null);
  }, []);

  // Backwards-compatible aliases (older JSX references)
  const handleOpenMessageMenu = openMenu;
  const handleCloseMessageMenu = closeMenu;

  const runMessageMenuAction = useCallback(
    (action: (message: Message) => Promise<void> | void) => {
      const picked = selectedMessage;
      closeMenu();

      setTimeout(() => {
        if (!picked) return;
        void action(picked);
      }, 10);
    },
    [closeMenu, selectedMessage]
  );

  const closeDeleteConfirm = useCallback(() => {
    setIsDeleteConfirmVisible(false);
    setPendingDeleteMessage(null);
  }, []);

  const handleReply = useCallback((message: Message) => {
    closeMenu();
    setReplyTarget(message);
  }, [closeMenu]);

  const handleCopy = useCallback((message: Message) => {
    closeMenu();
    const textValue = String(message.text ?? "").trim();
    if (!textValue) return;

    try {
      Clipboard.setString(textValue);
      if (Platform.OS === "android") {
        ToastAndroid.show(t("chat.copied"), ToastAndroid.SHORT);
      }
    } catch (e) {
      console.warn("[Chat] copy failed", e);
    }
  }, [closeMenu, t]);

  const handleDelete = useCallback((message: Message) => {
    closeMenu();
    if (message.sender?.id !== meId) return;
    setPendingDeleteMessage(message);
    setIsDeleteConfirmVisible(true);
  }, [closeMenu, meId]);

  const handleDeleteConfirmed = useCallback(async () => {
    const target = pendingDeleteMessage;
    if (!target) return;

    closeDeleteConfirm();
    await onDeleteMessage(target);
  }, [pendingDeleteMessage, onDeleteMessage, closeDeleteConfirm]);

  const handleCopyText = useCallback(
    (value: string) => {
      const textValue = String(value ?? "").trim();
      if (!textValue) return;

      try {
        Clipboard.setString(textValue);
        if (Platform.OS === "android") {
          ToastAndroid.show(t("chat.copied"), ToastAndroid.SHORT);
        }
      } catch (e) {
        console.warn("[Chat] copy failed", e);
      }
    },
    [t]
  );

  const handleOpenUrl = useCallback(
    async (rawUrl: string) => {
      const url = normalizeExternalUrl(rawUrl);
      if (!url) {
        Alert.alert(t("common.error"), "Invalid link.");
        return;
      }

      try {
        const candidates = [url];
        const encoded = encodeURI(url);
        if (encoded !== url) candidates.push(encoded);

        // For standard web links, try opening directly first.
        if (/^https?:\/\//i.test(url)) {
          let opened = false;
          for (const candidate of candidates) {
            try {
              await Linking.openURL(candidate);
              opened = true;
              break;
            } catch {
              // try next candidate
            }
          }

          if (!opened) {
            Alert.alert(t("common.error"), "Unable to open this link.");
          }
          return;
        }

        const ok = await Linking.canOpenURL(url);
        if (!ok) {
          Alert.alert(t("common.error"), "Unable to open this link.");
          return;
        }

        await Linking.openURL(url);
      } catch (e: any) {
        console.warn("[Chat] open url failed", e);
        Alert.alert(t("common.error"), "Unable to open this link.");
      }
    },
    [t]
  );

  useEffect(() => {
    setIsMessageMenuVisible(false);
    setSelectedMessage(null);
    closeDeleteConfirm();
  }, [sel, closeDeleteConfirm]);

  /** ===== Header ===== */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: "#111" },
      headerTintColor: "#fff",
      headerTitle: () => (
        <Pressable
          style={{ flex: 1, minWidth: 0 }}
          onPress={() => {
            if (!selectedChat) return;
            if (!selectedChat.is_group && partner?.id) {
              navigation.navigate("Profile", { id: partner.id });
            }
          }}
        >
          <Text style={styles.navTitle} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.navSub} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </Pressable>
      ),
      headerRight: () => (
        <View style={{ flexDirection: "row", gap: 10, marginRight: 8 }}>
          <Pressable onPress={() => setChatsModalOpen(true)} style={styles.headerBtn}>
            <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
          </Pressable>

          <Pressable onPress={handleOpenChatMenu} style={styles.headerBtn}>
            {loadingChats || chatSettingsBusy ? (
              <ActivityIndicator />
            ) : (
              <Ionicons name="ellipsis-vertical" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      ),
    });
  }, [
    navigation,
    title,
    subtitle,
    selectedChat,
    partner?.id,
    loadingChats,
    chatSettingsBusy,
    handleOpenChatMenu,
  ]);

  /** ===== render chat item ===== */
  const renderChatItem = useCallback(
    ({ item }: { item: Chat }) => {
      const isActive = item.id === sel;

      const partnerUser = !item.is_group
        ? (item.members ?? []).find((m) => m.id !== meId)
        : null;

      const name = item.is_group ? item.name?.trim() || t("chat.group_chat") : partnerUser?.name || t("chat.user");
      const initial = getInitial(name);

      const last = item.last_message;
      const lastImages = Array.isArray(last?.images) ? last.images : [];
      const lastText =
        last?.text?.trim()
          ? String(last.text).trim().length > 44
            ? String(last.text).trim().slice(0, 41) + "…"
            : String(last.text).trim()
          : lastImages.length
          ? lastImages.length === 1
            ? `📷 ${t("chat.photo")}`
            : `📷 ${lastImages.length} ${t("chat.photos")}`
          : "";

      return (
        <Pressable
          onPress={() => openChatById(item.id)}
          style={({ pressed }) => [
            styles.chatItem,
            isActive && {
              backgroundColor: "rgba(22,119,255,0.10)",
              borderColor: "#1677ff",
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {name}
            </Text>
            {lastText ? (
              <Text style={styles.chatDesc} numberOfLines={1}>
                {lastText}
              </Text>
            ) : null}
          </View>

          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </Pressable>
      );
    },
    [sel, meId, openChatById, t]
  );

  /** ===== render message item ===== */
  const renderMessageItem = useCallback(
    ({ item }: { item: Message }) => {
      const isMine = !!meId && item.sender?.id === meId;

      const timeLabel = formatTime(item.created_at);
      const hasText = !!item.text?.trim();
      const imgs = Array.isArray(item.images) ? item.images : [];

      const markThisRead = () => {
        client
          .mutate({ mutation: MUT_MARK_READ, variables: { message_id: item.id } })
          .catch(() => {});
      };

      const bubbleStyle = isMine ? styles.bubbleMine : styles.bubbleOther;
      const bubbleTextStyle = isMine ? styles.textMine : styles.textOther;
      const textParts = parseMessageTextParts(item.text);
      const isFocused = isMessageMenuVisible && selectedMessage?.id === item.id;

      return (
        <View style={[styles.msgRow, { justifyContent: isMine ? "flex-end" : "flex-start" }]}>
          <View style={[styles.msgBubbleWrap, { alignItems: isMine ? "flex-end" : "flex-start" }]}>
            {!isMine ? (
              <Pressable
                onPress={() => {
                  const uid = item.sender?.id;
                  if (uid) navigation.navigate("Profile", { id: uid });
                }}
              >
                <Text style={styles.msgSender} numberOfLines={1}>
                  {item.sender?.name || "—"}
                </Text>
              </Pressable>
            ) : null}

            {item.reply_to ? (
              <Pressable
                onPress={() => setReplyTarget(item.reply_to)}
                style={[
                  styles.replyPreview,
                  isMine ? styles.replyMine : styles.replyOther,
                ]}
              >
                <Text
                  style={[
                    styles.replySender,
                    { color: isMine ? "#fff" : "#93c5fd" },
                  ]}
                  numberOfLines={1}
                >
                  {item.reply_to?.sender?.id === meId
                    ? t("chat.you")
                    : item.reply_to?.sender?.name || t("chat.user")}
                </Text>

                {item.reply_to?.text ? (
                  <Text
                    style={[
                      styles.replyText,
                      { color: isMine ? "#f3f4f6" : "#d1d5db" },
                    ]}
                    numberOfLines={2}
                  >
                    {String(item.reply_to.text)}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}

            {imgs.length > 0 ? (
              <View style={[styles.imgGrid, { justifyContent: isMine ? "flex-end" : "flex-start" }]}>
                {imgs.slice(0, 4).map((img, idx) => {
                  const uri = getImgSrc(img);
                  if (!uri) return null;
                  const extra = imgs.length - 4;
                  const isLast = idx === 3 && extra > 0;

                  return (
                    <Pressable
                      key={img.id ?? `${item.id}-img-${idx}`}
                      onPress={() => setPreviewUri(uri)}
                      style={[styles.imgTile, isLast && { opacity: 0.8 }]}
                    >
                      <Image source={{ uri }} style={styles.imgTileImg} />
                      {isLast ? (
                        <View style={styles.imgOverlay}>
                          <Text style={styles.imgOverlayText}>+{extra}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {hasText ? (
              <Pressable
                onPress={markThisRead}
                onLongPress={() => openMenu(item)}
                delayLongPress={250}
              >
                <View style={[styles.msgBubble, bubbleStyle, isFocused && styles.msgBubbleFocused]}>
                  <Text style={[styles.msgText, bubbleTextStyle]}>
                    {textParts.map((part, idx) => {
                      if (part.type === "link") {
                        return (
                          <Text
                            key={`${item.id}-link-${idx}`}
                            style={[styles.msgLink, isMine ? styles.msgLinkMine : styles.msgLinkOther]}
                            onPress={() => {
                              void handleOpenUrl(part.href);
                            }}
                            suppressHighlighting
                          >
                            {displayUrlForWrap(part.value)}
                          </Text>
                        );
                      }

                      return (
                        <Text key={`${item.id}-txt-${idx}`}>{part.value}</Text>
                      );
                    })}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            <View style={[styles.msgMetaRow, isMine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
              <Text style={styles.msgMeta}>{timeLabel}</Text>
            </View>
          </View>
        </View>
      );
    },
    [
      meId,
      navigation,
      onDeleteMessage,
      t,
      handleOpenUrl,
      openMenu,
      isMessageMenuVisible,
      selectedMessage?.id,
    ]
  );

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const keyExtractor = useCallback((it: Message) => it.id, []);
  const isInitialLoading = loadingMsgs;
  const isFetchingMore = loadingMore;

  const scrollFabBottom = useMemo(() => {
    // Place FAB above composer + safe-area and above keyboard if open.
    // Extra gap keeps it from visually colliding with bubbles/composer.
    const gap = 12;
    const safeBottom = Math.max(insets.bottom, 0);
    const kb = Math.max(keyboardHeight, 0);
    const composer = Math.max(composerHeight, 0);
    return safeBottom + gap + (kb > 0 ? kb : composer);
  }, [composerHeight, keyboardHeight, insets.bottom]);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        {!sel ? (
          <View style={styles.center}>
            <Text style={{ color: "#9ca3af" }}>{t("chat.select_chat")}</Text>
          </View>
        ) : isInitialLoading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={{ color: "#9ca3af", marginTop: 8 }}>{t("chat.loading_messages")}</Text>
          </View>
        ) : (
          <>
            <FlatList
              ref={(r) => {
                listRef.current = r;
              }}
              data={invertedMessages}
              keyExtractor={keyExtractor}
              inverted
              contentContainerStyle={{ padding: 12, paddingBottom: 6 }}
              renderItem={renderMessageItem}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              onEndReachedThreshold={0.12}
              onMomentumScrollBegin={() => {
                onEndReachedLockRef.current = false;
              }}
              onEndReached={() => {
                if (onEndReachedLockRef.current) return;
                onEndReachedLockRef.current = true;
                void loadOlder();
              }}
              initialNumToRender={16}
              maxToRenderPerBatch={20}
              windowSize={11}
              removeClippedSubviews
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              ListFooterComponent={
                isFetchingMore ? (
                  <View style={{ paddingVertical: 10, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ color: "#9ca3af", marginTop: 6, fontSize: 12 }}>
                      {t("chat.loading_older")}
                    </Text>
                  </View>
                ) : !hasNextPage && messages.length > 0 ? (
                  <View style={{ paddingVertical: 10, alignItems: "center" }}>
                    <Text style={{ color: "#6b7280", fontSize: 12 }}>No older messages</Text>
                  </View>
                ) : null
              }
            />

            {showScrollToBottom && (
              <Pressable
                onPress={scrollToBottom}
                style={({ pressed }) => [
                  styles.scrollToBottomBtn,
                  { bottom: scrollFabBottom },
                  pressed && { opacity: 0.85 },
                ]}
                hitSlop={10}
              >
                <Ionicons name="arrow-down" size={20} color="#fff" />
              </Pressable>
            )}

            <View
              style={{ paddingBottom: composerBottomPad }}
              onLayout={(e) => {
                const h = e?.nativeEvent?.layout?.height;
                if (!Number.isFinite(h)) return;
                const next = Math.max(0, Math.round(h));
                setComposerHeight((prev) => (prev === next ? prev : next));
              }}
            >
              <SendMessageSection
                chats={{ myChats: chats }}
                sel={sel}
                text={text}
                setText={setText}
                onSend={onSend}
                me={me}
                replyTarget={replyTarget}
                setReplyTarget={setReplyTarget}
              />
            </View>
          </>
        )}
      </View>

      {/* ===== Chats Modal ===== */}
      <Modal
        visible={chatsModalOpen}
        animationType="slide"
        onRequestClose={() => setChatsModalOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("chat.chats")}</Text>
            <Pressable onPress={() => setChatsModalOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          {loadingChats ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={{ color: "#9ca3af", marginTop: 8 }}>{t("chat.loading_chats")}</Text>
            </View>
          ) : (
            <FlatList
              data={chats}
              keyExtractor={(it) => it.id}
              contentContainerStyle={{ padding: 12 }}
              renderItem={renderChatItem}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={{ color: "#9ca3af" }}>{t("chat.no_chats")}</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>

      {/* ===== Chat Action Sheet (LINE style) ===== */}
      <Modal
        visible={isMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseChatMenu}
      >
        <Pressable style={styles.actionSheetOverlay} onPress={handleCloseChatMenu}>
          <Pressable style={styles.actionSheetContainer} onPress={() => {}}>
            <Text style={styles.actionSheetTitle}>{t("app.chat_title")}</Text>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && styles.actionItemPressed,
              ]}
              onPress={() => runMenuAction(handleToggleChatNotifications)}
            >
              <Ionicons
                name={chatSettings.notifications_enabled ? "notifications-off-outline" : "notifications-outline"}
                size={18}
                color="#f3f4f6"
              />
              <Text style={styles.actionItemText}>
                {chatSettings.notifications_enabled
                  ? t("chat.turn_off_notifications")
                  : t("chat.turn_on_notifications")}
              </Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && styles.actionItemPressed,
              ]}
              onPress={() => runMenuAction(handleToggleMuteChat)}
            >
              <Ionicons
                name={chatSettings.is_muted ? "volume-high-outline" : "volume-mute-outline"}
                size={18}
                color="#f3f4f6"
              />
              <Text style={styles.actionItemText}>
                {chatSettings.is_muted ? t("chat.unmute") : t("chat.mute")}
              </Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && styles.actionItemPressed,
              ]}
              onPress={() => runMenuAction(handleRefreshChat)}
            >
              <Ionicons name="refresh-outline" size={18} color="#f3f4f6" />
              <Text style={styles.actionItemText}>{t("chat.refresh")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Message Action Sheet ===== */}
      <Modal
        visible={isMessageMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseMessageMenu}
      >
        <Pressable style={styles.actionSheetOverlay} onPress={handleCloseMessageMenu}>
          <Pressable style={styles.actionSheetContainer} onPress={() => {}}>
            <Text style={styles.actionSheetTitle}>{t("app.chat_title")}</Text>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && styles.actionItemPressed,
              ]}
              onPress={() =>
                runMessageMenuAction((message) => {
                  setReplyTarget(message);
                })
              }
            >
              <Ionicons name="return-up-back-outline" size={18} color="#f3f4f6" />
              <Text style={styles.actionItemText}>{t("chat.reply")}</Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && styles.actionItemPressed,
                !(selectedMessage?.text?.trim()) && styles.actionItemDisabled,
              ]}
              disabled={!(selectedMessage?.text?.trim())}
              onPress={() =>
                runMessageMenuAction((message) => {
                  if (!message.text?.trim()) return;
                  handleCopyText(message.text);
                })
              }
            >
              <Ionicons name="copy-outline" size={18} color="#f3f4f6" />
              <Text style={styles.actionItemText}>Copy</Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(239,68,68,0.12)" }}
              style={({ pressed }) => [
                styles.actionItem,
                styles.actionItemDanger,
                pressed && styles.actionItemPressed,
                (!selectedMessage || selectedMessage.sender?.id !== meId) && styles.actionItemDisabled,
              ]}
              disabled={!selectedMessage || selectedMessage.sender?.id !== meId}
              onPress={() =>
                runMessageMenuAction((message) => {
                  if (message.sender?.id !== meId) return;
                  void onDeleteMessage(message);
                })
              }
            >
              <Ionicons name="trash-outline" size={18} color="#f87171" />
              <Text style={styles.actionItemDangerText}>{t("common.delete")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Image Preview ===== */}
      <Modal
        visible={!!previewUri}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
      >
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewUri(null)}>
          <View style={styles.previewInner}>
            {previewUri ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.previewImg}
                resizeMode="contain"
              />
            ) : null}
            <Pressable
              style={styles.previewClose}
              onPress={() => setPreviewUri(null)}
              hitSlop={10}
            >
              <Ionicons name="close-circle" size={30} color="#fff" />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** =========================
 * Styles
 * ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  // header buttons
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1d1d25",
    alignItems: "center",
    justifyContent: "center",
  },

  // header title
  navTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  navSub: { color: "#9ca3af", fontSize: 11, marginTop: 2 },

  // modal chats
  modalWrap: { flex: 1, backgroundColor: "#0b0b0f" },
  modalHeader: {
    height: 56,
    backgroundColor: "#111",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },

  actionSheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  actionSheetContainer: {
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
  },
  actionSheetTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    textAlign: "left",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  actionItem: {
    width: "100%",
    minHeight: 52,
    backgroundColor: "#2C2C2E",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionItemPressed: {
    opacity: 0.8,
  },
  actionItemText: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "left",
    flex: 1,
  },
  actionItemDanger: {
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  actionItemDangerText: {
    color: "#f87171",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "left",
    flex: 1,
  },
  actionItemDisabled: {
    opacity: 0.45,
  },

  chatItem: {
    backgroundColor: "#111116",
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f1f26",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#1677ff",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "900" },
  chatTitle: { color: "#fff", fontWeight: "900" },
  chatDesc: { color: "#9ca3af", fontSize: 12, marginTop: 2 },

  // messages
  msgRow: { flexDirection: "row", marginVertical: 6 },
  msgBubbleWrap: { maxWidth: "82%" },

  msgSender: { color: "#9ca3af", fontSize: 11, marginBottom: 2 },

  replyPreview: {
    borderLeftWidth: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginBottom: 6,
  },
  replyMine: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderLeftColor: "#fff",
  },
  replyOther: {
    backgroundColor: "#10131a",
    borderLeftColor: "#60a5fa",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  replySender: { fontSize: 11, fontWeight: "800", marginBottom: 2 },
  replyText: { fontSize: 12 },

  imgGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  imgTile: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#111",
    position: "relative",
  },
  imgTileImg: { width: "100%", height: "100%" },
  imgOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  imgOverlayText: { color: "#fff", fontWeight: "900", fontSize: 18 },

  msgBubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  msgBubbleFocused: {
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.9)",
    shadowColor: "#60a5fa",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },

  // ✅ bubble colors
  bubbleMine: {
    backgroundColor: "#1677ff",
  },
  bubbleOther: {
    backgroundColor: "#171a22", // ✅ dark (แทนสีขาว)
    borderWidth: 1,
    borderColor: "#2a2a35",
  },

  msgText: { fontSize: 14, lineHeight: 18 },
  msgLink: {
    textDecorationLine: "underline",
    textDecorationStyle: "solid",
  },
  msgLinkMine: {
    color: "#dbeafe",
  },
  msgLinkOther: {
    color: "#60a5fa",
  },

  // ✅ text colors
  textMine: { color: "#fff" },
  textOther: { color: "#e5e7eb" },

  msgMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  msgMeta: { color: "#9ca3af", fontSize: 11 },

  scrollToBottomBtn: {
    position: "absolute",
    right: 16,
    bottom: 88,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1f2937",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  // preview
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewInner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImg: { width: "92%", height: "82%" },
  previewClose: { position: "absolute", top: 46, right: 16 },
});
