// src/components/GlobalChatListener.tsx
import React, { useEffect } from "react";
import { AppState, AppStateStatus } from "react-native";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { getGlobalChatState, useGlobalChatStore } from "../store/globalChatStore";
import { emitBookmarkStatusChanged } from "../events/bookmarkSync";

// ================= GraphQL =================

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

const SUB_INCOMING = gql`
  subscription ($user_id: ID!) {
    incomingMessage(user_id: $user_id) {
      id
      chat_id
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
`;

const SUB_USER_MESSAGE = gql`
  subscription ($user_id: ID!) {
    userMessageAdded(user_id: $user_id) {
      id
      chat_id
      sender {
        id
        name
        phone
        email
      }
      text
      created_at
      to_user_ids
    }
  }
`;

const SUB_TIME = gql`
  subscription {
    time
  }
`;

const SUB_MY_BOOKMARK_STATUS_CHANGED = gql`
  subscription MyBookmarkStatusChanged {
    myBookmarkStatusChanged {
      user_id
      action
      target_type
      target_id
      bookmarked
      updated_at
    }
  }
`;

// ================= Optional notify stub =================
async function notifyLocal(title: string, body?: string) {
  // TODO: เสียบ notifee / expo-notifications ได้ตรงนี้
  console.log("[LOCAL NOTIFY]", title, body);
}

// ================= Helpers =================

type Me = { id: string; name?: string };

function updateChatLastMessageInCache(m: any) {
  // อัปเดต sidebar list: last_message
  client.cache.updateQuery<{ myChats: any[] }>({ query: Q_CHATS }, (old) => {
    if (!old?.myChats) return old;

    return {
      myChats: old.myChats.map((chat) =>
        chat.id !== m.chat_id
          ? chat
          : {
              ...chat,
              last_message: {
                id: m.id,
                text: m.text,
                created_at: m.created_at,
                sender: m.sender,
                images: m.images ?? [],
              },
              last_message_at: m.created_at,
            }
      ),
    };
  });
}

// ================= Component =================

export function GlobalChatListener() {
  const setAppFocused = useGlobalChatStore((s) => s.setAppFocused);
  const incrementUnread = useGlobalChatStore((s) => s.incrementUnread);

  useEffect(() => {
    let mounted = true;
    let unsubIncoming: null | (() => void) = null;
    let unsubUserMsg: null | (() => void) = null;
    let unsubTime: null | (() => void) = null;
    let unsubBookmark: null | (() => void) = null;

    // 1) AppState -> Zustand
    const onAppState = (st: AppStateStatus) => {
      const active = st === "active";
      setAppFocused(active);
      if (active) {
        void client.refetchQueries({ include: ["MyBookmarks"] }).catch(() => {});
      }
    };
    const appSub = AppState.addEventListener("change", onAppState);
    setAppFocused(AppState.currentState === "active");

    async function boot() {
      try {
        // 2) Get meId
        const meRes = await client.query<{ me: Me }>({
          query: Q_ME,
          fetchPolicy: "network-only",
        });

        const meId = meRes?.data?.me?.id;
        if (!mounted || !meId) return;

        // 3) SUB_INCOMING
        const incomingObs = client.subscribe({
          query: SUB_INCOMING,
          variables: { user_id: meId },
        });

        console.log("[SUB_INCOMING][incomingObs] meId = ", meId);

        const incomingSub = incomingObs.subscribe({
          next: async (payload: any) => {

            console.log("[SUB_INCOMING][subscribe] payload = ", payload);
            const m = payload?.data?.incomingMessage;
            if (!m) return;

            const state = getGlobalChatState();
            const isCurrentRoom = state.currentChatId === m.chat_id;
            const isFocused = state.appFocused;

            // เพิ่ม unread เฉพาะตอน: ไม่ได้เปิดห้องนี้ หรือ app ไม่ได้อยู่ foreground
            if (!(isCurrentRoom && isFocused)) {
              incrementUnread(m.chat_id, 1);
              await notifyLocal(m.sender?.name || "New message", m.text || "ส่งรูปภาพมา");
            }

            updateChatLastMessageInCache(m);
          },
          error: (err) => {
            console.error("[SUB_INCOMING ERROR]", err);
          },
        });

        unsubIncoming = () => incomingSub.unsubscribe();

        // 4) SUB_USER_MESSAGE (optional notify เพิ่มเติม)
        const userMsgObs = client.subscribe({
          query: SUB_USER_MESSAGE,
          variables: { user_id: meId },
        });

        const userMsgSub = userMsgObs.subscribe({
          next: async (payload: any) => {
            const msg = payload?.data?.userMessageAdded;
            if (!msg) return;

            const state = getGlobalChatState();
            const isCurrentRoom = state.currentChatId === msg.chat_id;
            const isFocused = state.appFocused;

            if (!(isCurrentRoom && isFocused)) {
              await notifyLocal("ข้อความใหม่", msg.text);
            }
          },
          error: (err) => console.error("[SUB_USER_MESSAGE ERROR]", err),
        });

        unsubUserMsg = () => userMsgSub.unsubscribe();

        // 5) SUB_TIME (debug)
        const timeObs = client.subscribe({ query: SUB_TIME });
        const timeSub = timeObs.subscribe({
          next: (payload: any) => console.log("[TIME SUB] =", payload?.data?.time),
          error: (err) => console.error("[TIME SUB ERROR]", err),
        });

        unsubTime = () => timeSub.unsubscribe();

        // 6) Bookmark realtime (same-user multi-device sync)
        const bmObs = client.subscribe({ query: SUB_MY_BOOKMARK_STATUS_CHANGED });
        const bmSub = bmObs.subscribe({
          next: (payload: any) => {
            const p = payload?.data?.myBookmarkStatusChanged;
            if (!p) return;

            const postId = String(p.target_id || "").trim();
            if (!postId) return;

            const cacheId = client.cache.identify({ __typename: "Post", id: postId });
            if (cacheId) {
              client.cache.modify({
                id: cacheId,
                fields: {
                  is_bookmarked() {
                    return !!p.bookmarked;
                  },
                },
              });
            }

            emitBookmarkStatusChanged({
              target_type: "POST",
              target_id: postId,
              bookmarked: !!p.bookmarked,
              updated_at: p.updated_at || undefined,
            });
          },
          error: (err) => console.error("[SUB_MY_BOOKMARK_STATUS_CHANGED ERROR]", err),
        });

        unsubBookmark = () => bmSub.unsubscribe();
      } catch (e: any) {
        console.error("[GlobalChatListener boot error]", e?.message || e);
      }
    }

    boot();

    return () => {
      mounted = false;
      try {
        appSub.remove();
      } catch {}
      try {
        unsubIncoming?.();
      } catch {}
      try {
        unsubUserMsg?.();
      } catch {}
      try {
        unsubTime?.();
      } catch {}
      try {
        unsubBookmark?.();
      } catch {}
    };
  }, [incrementUnread, setAppFocused]);

  return null;
}