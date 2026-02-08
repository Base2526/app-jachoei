// src/components/HeaderAccountButton.tsx
import React from "react";
import { Pressable, View, Text } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth/AuthProvider";

export const HeaderAccountButton = () => {
  const navigation = useNavigation<any>();
  const { isLoggedIn, user } = useAuth();

  const badgeColor = isLoggedIn ? "#34c759" : "#ff3b30"; // เขียว / แดง
  const label = user?.name?.charAt(0)?.toUpperCase();

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
        {isLoggedIn && label ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#1e90ff",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>{label}</Text>
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
