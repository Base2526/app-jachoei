import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { client } from "../apollo/client";
import { LOGIN, LOGIN_SOCIAL } from "./auth.gql";
import {
  AuthUser,
  clearAuth,
  loadAuth,
  saveAuth,
} from "./auth.storage";

import { gql } from "@apollo/client";

/* =======================
 * Types
 * ======================= */

type LoginInput =
  | { email: string; password: string }
  | { username: string; password: string };

type SocialInput = {
  provider: "google" | "facebook" | "apple";
  accessToken: string;
};

type AuthState = {
  booting: boolean;
  token: string | null;
  user: AuthUser | null;
  isLoggedIn: boolean;

  login: (payload: { identifier: string; password: string }) => Promise<void>;
  loginWithSocial: (payload: SocialInput) => Promise<void>;
  logout: () => Promise<void>;
};

/* =======================
 * Context
 * ======================= */

const AuthContext = createContext<AuthState | null>(null);

/* =======================
 * Provider
 * ======================= */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  /* ---------- load token from storage ---------- */
  useEffect(() => {
    (async () => {
      try {
        const saved = await loadAuth();
        setToken(saved.token);
        setUser(saved.user);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const isLoggedIn = !!token;

  /* =======================
   * login (username/email + password)
   * ======================= */
  const login = async ({
    identifier,
    password,
  }: {
    identifier: string;
    password: string;
  }) => {
    const id = identifier.trim();
    const input: LoginInput = id.includes("@")
      ? { email: id, password }
      : { username: id, password };

    const { data } = await client.mutate({
      mutation: LOGIN,
      variables: { input },
    });

    const res = data?.loginUser;
    if (!res?.ok) {
      throw new Error(res?.message || "Login failed");
    }
    if (!res?.token) {
      throw new Error("Login failed: missing token");
    }

    const nextUser: AuthUser = res.user || {};

    await saveAuth(res.token, nextUser);
    setToken(res.token);
    setUser(nextUser);
  };

  /* =======================
   * login with social
   * ======================= */
  const loginWithSocial = async ({
    provider,
    accessToken,
  }: SocialInput) => {
    const { data } = await client.mutate({
      mutation: LOGIN_SOCIAL,
      variables: {
        input: {
          provider,
          accessToken,
        },
      },
    });

    const res = data?.loginWithSocial;

    console.log("[loginWithSocial] =", res);
    if (!res?.ok) {
      throw new Error(res?.message || "Social login failed");
    }
    if (!res?.token) {
      throw new Error("Social login failed: missing token");
    }

    const nextUser: AuthUser = res.user || {};

    await saveAuth(res.token, nextUser);
    setToken(res.token);
    setUser(nextUser);
  };

  /* =======================
   * logout
   * ======================= */
  const logout = async () => {
    // best-effort: unregister push token (if any) before clearing auth
    try {
      const fcmToken = await (async () => {
        try {
          const messaging = (await import("@react-native-firebase/messaging")).default;
          return await messaging().getToken();
        } catch {
          return null;
        }
      })();

      if (fcmToken) {
        const MUT_UNREGISTER_PUSH = gql`
          mutation UnregisterPushToken($fcmToken: String!) {
            unregisterPushToken(fcmToken: $fcmToken)
          }
        `;

        await client
          .mutate({
            mutation: MUT_UNREGISTER_PUSH,
            variables: { fcmToken },
          })
          .catch(() => {});
      }
    } catch {
      // ignore
    }

    await clearAuth();
    setToken(null);
    setUser(null);
  };

  /* =======================
   * context value
   * ======================= */
  const value = useMemo<AuthState>(
    () => ({
      booting,
      token,
      user,
      isLoggedIn,
      login,
      loginWithSocial,
      logout,
    }),
    [booting, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* =======================
 * Hook
 * ======================= */

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider />");
  }
  return ctx;
}
