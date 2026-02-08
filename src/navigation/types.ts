// src/navigation/types.ts
import { PostItem } from "../types/PostItem";

export type RootStackParamList = {
  SignIn: undefined; 
  ScamProtect: undefined;
  BlockedLogsSearch: undefined;
  PostView: { post: PostItem, currentUserId?: string };
  Profile: { id: string };
  Chat: { to: string };

  PostForm: undefined;
  Setting: undefined;
};
