// src/navigation/types.ts
import { PostItem } from "../types/PostItem";

export type RootStackParamList = {
  ScamProtect: undefined;
  BlockedLogsSearch: undefined;

  // ✅ ส่ง post เข้ามาแบบนี้
  PostView: { post: PostItem, currentUserId?: string };
};
