// src/store/authStore.ts
import { create } from "zustand";
import { AuthUser, clearAuth, loadAuth, saveAuth } from "../auth/auth.storage";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;

  bootstrap: () => Promise<void>;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  loading: true,

  async bootstrap() {
    const { token, user } = await loadAuth();
    set({ token, user, loading: false });
  },

  async login(token, user) {
    await saveAuth(token, user);
    set({ token, user });
  },

  async logout() {
    await clearAuth();
    set({ token: null, user: null });
  },
}));
