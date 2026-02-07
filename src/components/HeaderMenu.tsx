import React from "react";
import { Pressable, Alert, type AlertButton } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

type MenuItem = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

type Props = {
  items: MenuItem[];
};

export const HeaderMenu: React.FC<Props> = ({ items }) => {
  const openMenu = () => {
    const buttons: AlertButton[] = [
      ...items.map<AlertButton>((i) => ({
        text: i.label,
        style: (i.destructive ? "destructive" : "default") as const,
        onPress: i.onPress,
      })),
      { text: "ยกเลิก", style: "cancel" as const },
    ];

    Alert.alert("เมนู", "", buttons, { cancelable: true });
  };

  return (
    <Pressable onPress={openMenu} style={{ paddingHorizontal: 14 }}>
      <Ionicons name="menu-outline" size={26} color="#fff" />
    </Pressable>
  );
};
