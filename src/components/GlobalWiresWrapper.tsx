// src/components/GlobalWiresWrapper.tsx
import React, { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { useAuthStore } from "../store/authStore";
import { GlobalChatListener } from "./GlobalChatListener";

export function GlobalWiresWrapper() {
  const navigation = useNavigation<any>();
  const { user, token, loading, bootstrap, logout } = useAuthStore();

  // โหลด auth จาก AsyncStorage ตอนเปิดแอป
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // ตัวอย่าง: ถ้า token หมดอายุจาก backend
  const forceLogout = async () => {
    await logout();
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  if (loading) return null; // หรือ splash

  // ยังไม่ login → ไม่ต้องเปิด socket / chat
  if (!token || !user) return null;

  return <GlobalChatListener />;
}
