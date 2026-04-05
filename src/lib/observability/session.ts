import AsyncStorage from "@react-native-async-storage/async-storage";

import { setLogSessionId } from "./logContext";

const KEY = "jachoei.session_id_v1";

function newSessionId(): string {
  return `ss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function ensureSessionId(): Promise<string> {
  const existed = await AsyncStorage.getItem(KEY).catch(() => null);
  const val = String(existed || "").trim();
  if (val) {
    setLogSessionId(val);
    return val;
  }

  const created = newSessionId();
  await AsyncStorage.setItem(KEY, created).catch(() => void 0);
  setLogSessionId(created);
  return created;
}
