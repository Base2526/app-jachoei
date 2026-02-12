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
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { client } from "../apollo/client";
import SendMessageSection, { UploadImage } from "../components/SendMessageSection";
import { ENV } from "../config/env";

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

const Q_MSGS = gql`
  query ($chat_id: ID!, $limit: Int, $offset: Int) {
    messages(chat_id: $chat_id, limit: $limit, offset: $offset) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const MUT_SEND = gql`
  mutation (
    $chat_id: ID!
    $text: String!
    $to_user_ids: [ID!]!
    $images: [Upload!]
    $reply_to_id: ID
  ) {
    sendMessage(
      chat_id: $chat_id
      text: $text
      to_user_ids: $to_user_ids
      images: $images
      reply_to_id: $reply_to_id
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

/** =========================
 * Helpers
 * ========================= */
const PAGE_SIZE = 40;

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

/** =========================
 * Screen
 * ========================= */
export default function ChatScreen({ navigation }: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [sel, setSel] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [text, setText] = useState("");
  const [replyTarget, setReplyTarget] = useState<any | null>(null);

  const [chatsModalOpen, setChatsModalOpen] = useState(false);

  const subAddedRef = useRef<any>(null);
  const subDeletedRef = useRef<any>(null);

  const meId = me?.id;

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

  const otherMembers = useMemo(() => {
    const ms = selectedChat?.members ?? [];
    return ms.filter((m) => m?.id && m.id !== meId);
  }, [selectedChat?.members, meId]);

  const toUserIds = useMemo(() => otherMembers.map((m) => m.id), [otherMembers]);

  const partner = useMemo(() => {
    if (!selectedChat || selectedChat?.is_group) return null;
    return (selectedChat.members ?? []).find((m) => m.id !== meId) ?? null;
  }, [selectedChat, meId]);

  const title = useMemo(() => {
    if (!selectedChat) return "Chat";
    if (selectedChat.is_group) return selectedChat.name?.trim() || "Group Chat";
    return partner?.name || "Chat";
  }, [selectedChat, partner]);

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
    return partner?.id ? "Tap to view profile" : "";
  }, [selectedChat, meId, partner?.id]);

  /** ===== load me + chats ===== */
  const loadMeAndChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const meRes = await client.query<{ me: Me }>({
        query: Q_ME,
        fetchPolicy: "network-only",
      });
      setMe(meRes.data?.me ?? null);

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

      if (!sel && sorted.length) {
        openChatById(sorted[0].id);
      }
    } catch (e: any) {
      Alert.alert("Load error", e?.message || "unknown");
    } finally {
      setLoadingChats(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  useEffect(() => {
    loadMeAndChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== load messages for chat ===== */
  const loadMessages = useCallback(
    async (chatId: string, mode: "replace" | "append", offset: number) => {
      if (!chatId) return;

      if (mode === "replace") setLoadingMsgs(true);
      else setLoadingMore(true);

      try {
        const res = await client.query<{ messages: Message[] }>({
          query: Q_MSGS,
          variables: { chat_id: chatId, limit: PAGE_SIZE, offset },
          fetchPolicy: "network-only",
        });

        const got = res.data?.messages ?? [];
        const sorted = [...got].sort(
          (a, b) =>
            safeDate(a.created_at).getTime() - safeDate(b.created_at).getTime()
        );
        setHasMore(got.length >= PAGE_SIZE);

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

        const last = sorted[sorted.length - 1];
        if (last?.created_at) {
          client
            .mutate({
              mutation: MUT_MARK_UPTO,
              variables: { chat_id: chatId, cursor: last.created_at },
            })
            .catch(() => {});
        }
      } catch (e: any) {
        Alert.alert("Load messages error", e?.message || "unknown");
      } finally {
        if (mode === "replace") setLoadingMsgs(false);
        else setLoadingMore(false);
      }
    },
    []
  );

  /** ===== open chat ===== */
  const openChatById = useCallback(
    async (chatId: string) => {
      setSel(chatId);
      setChatsModalOpen(false);

      setCurrentChat(chatId);
      clearUnread(chatId);

      setReplyTarget(null);
      setText("");
      setHasMore(true);

      await loadMessages(chatId, "replace", 0);
    },
    [loadMessages, setCurrentChat, clearUnread]
  );

  /** ===== subscribe when sel changes ===== */
  useEffect(() => {
    if (!sel) return;

    setReplyTarget(null);
    setText("");
    setHasMore(true);

    setCurrentChat(sel);
    clearUnread(sel);

    loadMessages(sel, "replace", 0);

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
  }, [sel, loadMessages, setCurrentChat, clearUnread]);

  /** ===== load older (pagination) ===== */
  const loadOlder = useCallback(async () => {
    if (!sel) return;
    if (loadingMore || loadingMsgs) return;
    if (!hasMore) return;

    const offset = messages.length;
    await loadMessages(sel, "append", offset);
  }, [sel, loadingMore, loadingMsgs, hasMore, messages.length, loadMessages]);

  /** ===== send message ===== */
  const onSend = useCallback(
    async (args: {
      chat_id: string;
      text: string;
      to_user_ids: string[];
      images?: UploadImage[];
      reply_to_id?: string | null;
    }) => {
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

      if (sel && newMsg.created_at) {
        client
          .mutate({
            mutation: MUT_MARK_UPTO,
            variables: { chat_id: sel, cursor: newMsg.created_at },
          })
          .catch(() => {});
      }
    },
    [sel]
  );

  /** ===== delete message ===== */
  const onDeleteMessage = useCallback(async (m: Message) => {
    Alert.alert("Delete message?", "ต้องการลบข้อความนี้ใช่ไหม", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await client.mutate({
              mutation: MUT_DELETE_MSG,
              variables: { message_id: m.id },
            });
            setMessages((prev) => prev.filter((x) => x.id !== m.id));
          } catch (e: any) {
            Alert.alert("Delete failed", e?.message || "unknown");
          }
        },
      },
    ]);
  }, []);

  /** ===== image preview ===== */
  const [previewUri, setPreviewUri] = useState<string | null>(null);

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

          <Pressable onPress={loadMeAndChats} style={styles.headerBtn}>
            {loadingChats ? (
              <ActivityIndicator />
            ) : (
              <Ionicons name="refresh-outline" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      ),
    });
  }, [navigation, title, subtitle, selectedChat, partner?.id, loadMeAndChats, loadingChats]);

  /** ===== render chat item ===== */
  const renderChatItem = useCallback(
    ({ item }: { item: Chat }) => {
      const isActive = item.id === sel;

      const partnerUser = !item.is_group
        ? (item.members ?? []).find((m) => m.id !== meId)
        : null;

      const name = item.is_group ? item.name?.trim() || "Group" : partnerUser?.name || "User";
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
            ? "📷 Photo"
            : `📷 ${lastImages.length} photos`
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
    [sel, meId, openChatById]
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
                onPress={() => Alert.alert("Reply", "ข้อความนี้เป็นการตอบกลับ")}
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
                    ? "You"
                    : item.reply_to?.sender?.name || "User"}
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
              <Pressable onPress={markThisRead}>
                <View style={[styles.msgBubble, bubbleStyle]}>
                  <Text style={[styles.msgText, bubbleTextStyle]}>{item.text}</Text>
                </View>
              </Pressable>
            ) : null}

            <View style={[styles.msgMetaRow, isMine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
              <Text style={styles.msgMeta}>{timeLabel}</Text>

              <Pressable onPress={() => setReplyTarget(item)} hitSlop={10} style={{ marginLeft: 10 }}>
                <Ionicons name="return-up-back-outline" size={16} color="#9ca3af" />
              </Pressable>

              {isMine ? (
                <Pressable onPress={() => onDeleteMessage(item)} hitSlop={10} style={{ marginLeft: 10 }}>
                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      );
    },
    [meId, navigation, onDeleteMessage]
  );

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        {!sel ? (
          <View style={styles.center}>
            <Text style={{ color: "#9ca3af" }}>Select a chat</Text>
          </View>
        ) : loadingMsgs ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={{ color: "#9ca3af", marginTop: 8 }}>Loading messages…</Text>
          </View>
        ) : (
          <>
            <FlatList
              data={invertedMessages}
              keyExtractor={(it) => it.id}
              inverted
              contentContainerStyle={{ padding: 12, paddingBottom: 6 }}
              renderItem={renderMessageItem}
              onEndReachedThreshold={0.2}
              onEndReached={() => loadOlder()}
              ListFooterComponent={
                loadingMore ? (
                  <View style={{ paddingVertical: 10, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ color: "#9ca3af", marginTop: 6, fontSize: 12 }}>
                      Loading older…
                    </Text>
                  </View>
                ) : null
              }
            />

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
            <Text style={styles.modalTitle}>Chats</Text>
            <Pressable onPress={() => setChatsModalOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>

          {loadingChats ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={{ color: "#9ca3af", marginTop: 8 }}>Loading chats…</Text>
            </View>
          ) : (
            <FlatList
              data={chats}
              keyExtractor={(it) => it.id}
              contentContainerStyle={{ padding: 12 }}
              renderItem={renderChatItem}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={{ color: "#9ca3af" }}>No chats</Text>
                </View>
              }
            />
          )}
        </View>
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

  // ✅ text colors
  textMine: { color: "#fff" },
  textOther: { color: "#e5e7eb" },

  msgMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  msgMeta: { color: "#9ca3af", fontSize: 11 },

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
