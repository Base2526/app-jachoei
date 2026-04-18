import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import {
  getCachedDeviceInfo,
  loadDeviceInfo,
  type AppDeviceInfo,
} from "../device/deviceInfo";

export const morePalette = {
  background: "#0b0b0f",
  card: "#12141c",
  cardAlt: "#171a24",
  border: "#23283a",
  text: "#ffffff",
  muted: "#b6bfd2",
  subtle: "#7f8aa3",
  accent: "#1e90ff",
  accentSoft: "rgba(30, 144, 255, 0.14)",
};

export function useAppDeviceInfo() {
  const [deviceInfo, setDeviceInfo] = useState<AppDeviceInfo | null>(() =>
    getCachedDeviceInfo()
  );

  useEffect(() => {
    let mounted = true;

    if (deviceInfo) return;

    void loadDeviceInfo()
      .then((info) => {
        if (mounted) setDeviceInfo(info);
      })
      .catch(() => {
        // ignore device info failures on secondary screens
      });

    return () => {
      mounted = false;
    };
  }, [deviceInfo]);

  return deviceInfo;
}

export function MoreScrollView({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function MoreIntroCard(props: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  const { eyebrow, title, description } = props;

  return (
    <View style={styles.introCard}>
      {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.introTitle}>{title}</Text>
      <Text style={styles.introDescription}>{description}</Text>
    </View>
  );
}

export function MoreSectionHeader(props: {
  title: string;
  description?: string;
}) {
  const { title, description } = props;

  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!description && <Text style={styles.sectionDescription}>{description}</Text>}
    </View>
  );
}

export function MoreCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function MoreActionRow(props: {
  icon: string;
  title: string;
  description: string;
  onPress?: () => void;
  disabled?: boolean;
  rightLabel?: string;
}) {
  const { icon, title, description, onPress, disabled, rightLabel } = props;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        disabled && styles.actionRowDisabled,
        pressed && !disabled && styles.actionRowPressed,
      ]}
    >
      <View style={styles.actionLeading}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={icon as any}
            size={18}
            color={disabled ? morePalette.subtle : morePalette.accent}
          />
        </View>

        <View style={styles.actionBody}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.actionDescription}>{description}</Text>
        </View>
      </View>

      {rightLabel ? (
        <View style={styles.rightPill}>
          <Text style={styles.rightPillText}>{rightLabel}</Text>
        </View>
      ) : (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={disabled ? morePalette.subtle : morePalette.muted}
        />
      )}
    </Pressable>
  );
}

export function MoreInfoRow(props: {
  icon: string;
  title: string;
  description: string;
}) {
  const { icon, title, description } = props;

  return (
    <View style={styles.infoRow}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon as any} size={18} color={morePalette.accent} />
      </View>
      <View style={styles.actionBody}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
    </View>
  );
}

export function MoreMetaRow(props: {
  label: string;
  value?: string | null;
  loading?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const { label, value, loading, onPress, onLongPress } = props;

  return (
    <Pressable style={styles.metaRow} onPress={onPress} onLongPress={onLongPress}>
      <Text style={styles.metaLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={morePalette.muted} />
      ) : (
        <Text style={styles.metaValue}>{value || "-"}</Text>
      )}
    </Pressable>
  );
}

export function MoreButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

export function MoreButton(props: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary";
}) {
  const { label, onPress, disabled, tone = "secondary" } = props;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone === "primary" ? styles.buttonTextPrimary : styles.buttonTextSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const moreCommonStyles = StyleSheet.create({
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
  },
  chip: {
    minWidth: "47%",
    borderWidth: 1,
    borderColor: morePalette.border,
    backgroundColor: morePalette.cardAlt,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chipText: {
    color: morePalette.text,
    fontSize: 14,
    fontWeight: "700",
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: morePalette.background,
  },
  content: {
    paddingHorizontal: 0,
    paddingTop: 16,
    paddingBottom: 28,
  },
  introCard: {
    backgroundColor: morePalette.card,
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: morePalette.border,
    padding: 12,
    marginBottom: 18,
  },
  eyebrow: {
    color: morePalette.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  introTitle: {
    color: morePalette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  introDescription: {
    color: morePalette.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  sectionHeader: {
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    color: morePalette.text,
    fontSize: 18,
    fontWeight: "800",
  },
  sectionDescription: {
    color: morePalette.subtle,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  card: {
    backgroundColor: morePalette.card,
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: morePalette.border,
    overflow: "visible",
    marginBottom: 18,
  },
  actionRow: {
    minHeight: 76,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: morePalette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "transparent",
  },
  actionRowPressed: {
    backgroundColor: morePalette.accentSoft,
  },
  actionRowDisabled: {
    opacity: 0.72,
  },
  actionLeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: morePalette.cardAlt,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  actionBody: {
    flex: 1,
  },
  actionTitle: {
    color: morePalette.text,
    fontSize: 15,
    fontWeight: "700",
  },
  actionDescription: {
    color: morePalette.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  rightPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: morePalette.cardAlt,
    borderWidth: 1,
    borderColor: morePalette.border,
  },
  rightPillText: {
    color: morePalette.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
  },
  button: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    flex: 1,
  },
  buttonPrimary: {
    backgroundColor: morePalette.accent,
    borderColor: morePalette.accent,
  },
  buttonSecondary: {
    backgroundColor: morePalette.cardAlt,
    borderColor: morePalette.border,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.86,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  buttonTextPrimary: {
    color: "#fff",
  },
  buttonTextSecondary: {
    color: morePalette.text,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: morePalette.border,
  },
  metaRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: morePalette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLabel: {
    color: morePalette.muted,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
    paddingRight: 12,
  },
  metaValue: {
    color: morePalette.text,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    textAlign: "right",
  },
});