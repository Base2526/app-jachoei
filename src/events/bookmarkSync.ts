import { DeviceEventEmitter } from "react-native";

export const BOOKMARK_STATUS_CHANGED_EVENT = "bookmark-status-changed";

export type BookmarkStatusChangedEvent = {
  target_type: "POST";
  target_id: string;
  bookmarked: boolean;
  updated_at?: string;
};

export function emitBookmarkStatusChanged(e: BookmarkStatusChangedEvent) {
  DeviceEventEmitter.emit(BOOKMARK_STATUS_CHANGED_EVENT, e);
}

export function subscribeBookmarkStatusChanged(
  cb: (e: BookmarkStatusChangedEvent) => void
): () => void {
  const sub = DeviceEventEmitter.addListener(BOOKMARK_STATUS_CHANGED_EVENT, cb);
  return () => sub.remove();
}
