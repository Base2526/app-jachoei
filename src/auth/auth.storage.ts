import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_TOKEN = "jachoei.token";
const KEY_USER = "jachoei.user";

export type AuthUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

export async function saveAuth(token: string, user: AuthUser) {
  await AsyncStorage.multiSet([
    [KEY_TOKEN, token],
    [KEY_USER, JSON.stringify(user || {})],
  ]);
}

export async function clearAuth() {
  await AsyncStorage.multiRemove([KEY_TOKEN, KEY_USER]);
}

export async function loadAuth(): Promise<{ token: string | null; user: AuthUser | null }> {
  const [[, token], [, userRaw]] = await AsyncStorage.multiGet([KEY_TOKEN, KEY_USER]);
  const user = userRaw ? (JSON.parse(userRaw) as AuthUser) : null;
  return { token: token || null, user };
}
