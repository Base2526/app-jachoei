// src/store/globalChatStore.ts
import { create } from "zustand";

export type UnreadMap = Record<string, number>;

export type GlobalChatState = {
  currentChatId: string | null;     // ห้องที่กำลังเปิด
  appFocused: boolean;              // app foreground ไหม
  unreadByChat: UnreadMap;          // chat_id -> unread count

  setCurrentChat: (chatId: string | null) => void;
  setAppFocused: (focused: boolean) => void;
  incrementUnread: (chatId: string, by?: number) => void;
  clearUnread: (chatId: string) => void;
  clearAllUnread: () => void;
  getTotalUnread: () => number;
};

export const useGlobalChatStore = create<GlobalChatState>((set, get) => ({
  currentChatId: null,
  appFocused: true,
  unreadByChat: {},

  setCurrentChat(chatId) {
    set((s) => {
      if (!chatId) return { currentChatId: null };

      // เข้า chat แล้วเคลียร์ unread ห้องนั้น
      const had = s.unreadByChat[chatId] ?? 0;
      return {
        currentChatId: chatId,
        unreadByChat: had > 0 ? { ...s.unreadByChat, [chatId]: 0 } : s.unreadByChat,
      };
    });
  },

  setAppFocused(focused) {
    set({ appFocused: focused });
  },

  incrementUnread(chatId, by = 1) {
    const map = get().unreadByChat;
    const current = map[chatId] ?? 0;
    set({
      unreadByChat: {
        ...map,
        [chatId]: current + by,
      },
    });
  },

  clearUnread(chatId) {
    const map = get().unreadByChat;
    if (!map[chatId]) return;
    set({ unreadByChat: { ...map, [chatId]: 0 } });
  },

  clearAllUnread() {
    set({ unreadByChat: {} });
  },

  getTotalUnread() {
    const map = get().unreadByChat;
    return Object.values(map).reduce((sum, n) => sum + (n || 0), 0);
  },
}));

export const getGlobalChatState = () => useGlobalChatStore.getState();
