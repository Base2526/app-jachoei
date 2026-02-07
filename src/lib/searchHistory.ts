// src/lib/searchHistory.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@blocked_logs_search_history";
const MAX_ITEMS = 20;

export async function getSearchHistory(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addSearchHistory(keyword: string) {
  const k = keyword.trim();
  if (!k) return;

  const list = await getSearchHistory();

  const next = [
    k,
    ...list.filter((x) => x !== k),
  ].slice(0, MAX_ITEMS);

  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function clearSearchHistory() {
  await AsyncStorage.removeItem(KEY);
}
