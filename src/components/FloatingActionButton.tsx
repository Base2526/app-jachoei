import React from "react";
import { Pressable, StyleSheet } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  onPress: () => void;
  icon?: string;
  iconSize?: number;
  accessibilityLabel?: string;
  bottomOffset?: number;
  rightOffset?: number;
};

const FAB_SIZE = 52;
const FAB_RIGHT = 20;
const FAB_BOTTOM = 20;

export function FloatingActionButton(props: Props) {
  const {
    onPress,
    icon = "add",
    iconSize = 20,
    accessibilityLabel = "Quick actions",
    bottomOffset,
    rightOffset,
  } = props;
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.fab,
        {
          right: rightOffset ?? FAB_RIGHT,
          bottom: Math.max(18, insets.bottom + (bottomOffset ?? FAB_BOTTOM)),
        },
      ]}
    >
      <Ionicons name={icon as any} size={iconSize} color="#0B0F19" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
    zIndex: 30,
  },
});