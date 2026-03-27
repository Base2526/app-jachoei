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

export const HeaderAccountButton = () => {
  const navigation = useNavigation<any>();
  const { isLoggedIn, user } = useAuth();
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

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
      style={{ marginRight: 14 }}
    >
      <View>
        {/* icon / avatar */}
        {isLoggedIn ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#1e90ff",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {shouldShowImage ? (
              <Image
                source={{ uri: avatarUri }}
                style={{ width: 28, height: 28, borderRadius: 14 }}
                resizeMode="cover"
                onError={() => setAvatarLoadFailed(true)}
              />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "900" }}>{label}</Text>
            )}
          </View>
        ) : (
          <Ionicons name="person-circle-outline" size={30} color="#fff" />
        )}

        {/* badge */}
        <View
          style={{
            position: "absolute",
            right: -2,
            top: -2,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: badgeColor,
            borderWidth: 1,
            borderColor: "#111",
          }}
        />
      </View>
    </Pressable>
  );
};
