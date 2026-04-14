import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { HeaderAccountButton } from "./HeaderAccountButton";
import { HeaderMenu } from "./HeaderMenu";

type HeaderMenuItem = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  icon?: string;
};

type HeaderIconButtonProps = {
  icon: string;
  onPress: () => void;
  badge?: string | number;
  compact?: boolean;
  accessibilityLabel?: string;
};

function HeaderIconButton(props: HeaderIconButtonProps) {
  const { icon, onPress, badge, compact = false, accessibilityLabel } = props;
  const buttonSize = compact ? 34 : 36;
  const iconSize = compact ? 18 : 19;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, { width: buttonSize, height: buttonSize, borderRadius: 12 }]}
      hitSlop={10}
    >
      <Ionicons name={icon as any} size={iconSize} color="#F8FAFC" />
      {badge ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

type Props = {
  isCompact?: boolean;
  showSearch?: boolean;
  showNotification?: boolean;
  showChat?: boolean;
  showProfile?: boolean;
  showMore?: boolean;
  onSearch: () => void;
  onNotification: () => void;
  onChat: () => void;
  notificationBadge?: string | number;
  chatBadge?: string | number;
  searchA11y: string;
  notificationA11y: string;
  chatA11y: string;
  menuTitle: string;
  menuCancelLabel: string;
  menuItems: HeaderMenuItem[];
};

export function HeaderActionsBar(props: Props) {
  const {
    isCompact = false,
    showSearch = true,
    showNotification = true,
    showChat = true,
    showProfile,
    showMore = true,
    onSearch,
    onNotification,
    onChat,
    notificationBadge,
    chatBadge,
    searchA11y,
    notificationA11y,
    chatA11y,
    menuTitle,
    menuCancelLabel,
    menuItems,
  } = props;

  // Profile is mandatory for consistent UX across auth states.
  const shouldShowProfile = true || !!showProfile;

  return (
    <View style={[styles.rightCluster, isCompact && styles.rightClusterCompact]}>
      {showSearch ? (
        <HeaderIconButton
          icon="search-outline"
          onPress={onSearch}
          compact={isCompact}
          accessibilityLabel={searchA11y}
        />
      ) : null}

      {showNotification ? (
        <HeaderIconButton
          icon="notifications-outline"
          badge={notificationBadge}
          compact={isCompact}
          accessibilityLabel={notificationA11y}
          onPress={onNotification}
        />
      ) : null}

      {showChat ? (
        <HeaderIconButton
          icon="chatbubbles-outline"
          badge={chatBadge}
          compact={isCompact}
          accessibilityLabel={chatA11y}
          onPress={onChat}
        />
      ) : null}

      {shouldShowProfile ? <HeaderAccountButton size={isCompact ? 34 : 36} variant="compact" /> : null}

      {showMore ? (
        <HeaderMenu
          items={menuItems}
          title={menuTitle}
          cancelLabel={menuCancelLabel}
          iconName="ellipsis-vertical"
          iconSize={isCompact ? 18 : 19}
          buttonSize={isCompact ? 34 : 36}
          color="#F8FAFC"
          styleVariant="compact"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rightCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: "#0f1624",
    borderWidth: 1,
    borderColor: "#1b2538",
  },
  rightClusterCompact: {
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#141c2a",
    borderWidth: 1,
    borderColor: "#243047",
  },
  iconBadge: {
    position: "absolute",
    top: -3,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F59E0B",
    borderWidth: 1,
    borderColor: "#0b0f19",
  },
  iconBadgeText: {
    color: "#161616",
    fontSize: 9,
    fontWeight: "900",
  },
});
