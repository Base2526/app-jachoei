// src/components/HeaderAccountButton.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, View, Text } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth/AuthProvider";
import { ENV } from "../config/env";

function normalizeAvatarUri(uri?: string | null) {
  if (!uri) return "";

  const value = String(uri).trim();
  if (!value) return "";

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("file://") || value.startsWith("content://") || value.startsWith("data:")) {
    return value;
  }

  if (value.startsWith("/")) {
    const base = ENV.apiBase.endsWith("/") ? ENV.apiBase.slice(0, -1) : ENV.apiBase;
    return `${base}${value}`;
  }

  return value;
}

type HeaderAccountButtonProps = {
  size?: number;
  variant?: "default" | "compact";
};

export const HeaderAccountButton = ({ size = 34, variant = "default" }: HeaderAccountButtonProps) => {
  const navigation = useNavigation<any>();
  const { isLoggedIn, user } = useAuth();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const radius = size / 2;
  const iconSize = size <= 34 ? 16 : 18;
  const labelFontSize = size <= 34 ? 12 : 13;
  const statusSize = size <= 34 ? 7 : 9;
  const statusRadius = statusSize / 2;
  const compact = variant === "compact";

  const badgeColor = isLoggedIn ? "#34c759" : "#ff3b30"; // เขียว / แดง
  const label = (user?.name || "").trim().charAt(0).toUpperCase() || "U";
  const avatarUri = useMemo(() => normalizeAvatarUri(user?.avatar), [user?.avatar]);
  const shouldShowImage = isLoggedIn && !!avatarUri && !avatarLoadFailed;

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarUri]);

//   console.log("[HeaderAccountButton] = ", isLoggedIn, user);

  return (
    <Pressable
      onPress={() => {
        if (!isLoggedIn) {
          navigation.navigate("SignIn"); // modal
          return;
        }
        navigation.navigate("Setting");
      }}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <View>
        {isLoggedIn ? (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: compact ? "#141c2a" : "#111827",
              borderWidth: 1,
              borderColor: compact ? "#243047" : "#1B2538",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {shouldShowImage ? (
              <Image
                source={{ uri: avatarUri }}
                style={{ width: size, height: size, borderRadius: radius }}
                resizeMode="cover"
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: labelFontSize }}>{label}</Text>
            )}
          </View>
        ) : (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: compact ? "#141c2a" : "#111827",
              borderWidth: 1,
              borderColor: compact ? "#243047" : "#1B2538",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="person-outline" size={iconSize} color="#F8FAFC" />
          </View>
        )}

        <View
          style={{
            position: "absolute",
            right: -1,
            top: -1,
            width: statusSize,
            height: statusSize,
            borderRadius: statusRadius,
            backgroundColor: badgeColor,
            borderWidth: 1,
            borderColor: "#0b0f19",
          }}
        />
      </View>
    </Pressable>
  );
};
