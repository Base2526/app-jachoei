import React, { useCallback, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type MenuItem = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  icon?: string;
};

type Props = {
  items: MenuItem[];
  title?: string;
  cancelLabel?: string;
  iconName?: string;
  iconSize?: number;
  buttonSize?: number;
  color?: string;
  styleVariant?: "default" | "compact";
};

export const HeaderMenu: React.FC<Props> = ({
  items,
  title = "เมนู",
  cancelLabel = "ยกเลิก",
  iconName = "menu-outline",
  iconSize = 26,
  buttonSize = 44,
  color = "#fff",
  styleVariant = "default",
}) => {
  const insets = useSafeAreaInsets();
  const triggerRef = useRef<View | null>(null);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState({ top: insets.top + 44, right: 16 });

  const closeMenu = useCallback(() => {
    setVisible(false);
  }, []);

  const openMenu = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get("window").width;
      const menuWidth = 208;
      const margin = 12;
      const estimatedLeft = Math.min(
        Math.max(margin, x + width - menuWidth),
        screenWidth - menuWidth - margin
      );

      setAnchor({
        top: Math.max(insets.top + 6, y + height + 8),
        right: Math.max(margin, screenWidth - (estimatedLeft + menuWidth)),
      });
      setVisible(true);
    });
  }, [insets.top]);

  const runItem = useCallback(
    (item: MenuItem) => {
      closeMenu();
      item.onPress();
    },
    [closeMenu]
  );

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
        accessibilityRole="button"
        hitSlop={10}
        style={
          styleVariant === "compact"
            ? [styles.compactTrigger, { width: buttonSize, height: buttonSize, borderRadius: 12 }]
            : styles.defaultTrigger
        }
      >
        <Ionicons name={iconName as any} size={iconSize} color={color} />
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.overlay} onPress={closeMenu}>
          <Pressable
            style={[
              styles.menu,
              {
                top: anchor.top,
                right: anchor.right,
              },
            ]}
            onPress={() => {}}
          >
            <Text style={styles.menuTitle} numberOfLines={1}>
              {title}
            </Text>

            <View style={styles.menuList}>
              {items.map((item, index) => (
                <Pressable
                  key={`${item.label}-${index}`}
                  onPress={() => runItem(item)}
                  android_ripple={{ color: "rgba(255,255,255,0.08)" }}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  {item.icon ? (
                    <Ionicons
                      name={item.icon as any}
                      size={17}
                      color={item.destructive ? "#f87171" : "#e5e7eb"}
                    />
                  ) : null}
                  <Text
                    style={[styles.menuItemText, item.destructive && styles.menuItemTextDestructive]}
                    numberOfLines={2}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={closeMenu}
              android_ripple={{ color: "rgba(255,255,255,0.06)" }}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.menuItemPressed]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  defaultTrigger: {
    paddingHorizontal: 14,
  },
  compactTrigger: {
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
    width: 208,
    backgroundColor: "#121722",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#253147",
    padding: 8,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  menuTitle: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
  },
  menuList: {
    gap: 4,
  },
  menuItem: {
    minHeight: 42,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#171d29",
  },
  menuItemPressed: {
    opacity: 0.86,
  },
  menuItemText: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
  menuItemTextDestructive: {
    color: "#fca5a5",
  },
  cancelButton: {
    marginTop: 6,
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },
});
