import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PENDING_CHAT_ID = "pending_chat_id";

export function extractChatIdFromData(data: any): string | null {
  const conversationId = String(data?.conversationId || "").trim();
  if (conversationId) return conversationId;

  const chatId = String(data?.chat_id || "").trim();
  return chatId || null;
}

export async function persistPendingChatId(chatId: string) {
  const id = String(chatId || "").trim();
  if (!id) return;
  await AsyncStorage.setItem(STORAGE_PENDING_CHAT_ID, id);
}
