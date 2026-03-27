// src/components/GlobalWiresWrapper.tsx
import React, { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { GlobalChatListener } from "./GlobalChatListener";
import { useAuth } from "../auth/AuthProvider";

export function GlobalWiresWrapper() {
  const navigation = useNavigation<any>();
  const { user, isLoggedIn, booting, logout } = useAuth();

  // ตัวอย่าง: ถ้า token หมดอายุจาก backend
  const forceLogout = async () => {
    await logout();
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  if (booting) return null; // หรือ splash

  // ยังไม่ login → ไม่ต้องเปิด socket / chat
  if (!isLoggedIn || !user) return null;

  return <GlobalChatListener />;
}
