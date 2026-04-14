import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import type { PhoneActionItem } from "../hooks/usePhoneActions";
import { ActionIconButton } from "./ActionIconButton";

type BusyAction = "block" | "unblock" | "report" | null;

type Props = {
  item: PhoneActionItem;
  onBlock: (phone: string) => void;
  onUnblock: (phone: string) => void;
  onReport: (phone: string) => void;
  onPress?: () => void;
  onViewPosts?: () => void;
  busyAction?: BusyAction;
};

function StatusChip(props: { label: string; tone: "neutral" | "warning" | "danger" }) {
  const { label, tone } = props;

  return (
    <View
      style={[
        styles.statusChip,
        tone === "warning" ? styles.statusChipWarning : tone === "danger" ? styles.statusChipDanger : styles.statusChipNeutral,
      ]}
    >
      <Text
        style={[
          styles.statusChipText,
          tone === "warning"
            ? styles.statusChipTextWarning
            : tone === "danger"
            ? styles.statusChipTextDanger
            : styles.statusChipTextNeutral,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function HighlyReportedBadge() {
  return (
    <View style={styles.badgePill}>
      <Text style={styles.badgeText} numberOfLines={1}>
        Highly Reported
      </Text>
    </View>
  );
}

export function PhoneCard(props: Props) {
  const { item, onBlock, onUnblock, onReport, onPress, onViewPosts, busyAction } = props;
  const phone = item.phone_normalized || item.phone;
  const isBlocked = !!item.my_blocked;
  const isHighlyReported = Number(item.report_count || 0) >= 10;
  const hasStatusRow = isBlocked || !!item.my_reported || !!item.in_history;
  const postCount = Number(item.post_count || 0);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && onPress ? styles.cardPressed : null]}>
      <View style={styles.cardRow}>
        <View style={styles.cardContent}>
          <View style={styles.headerRow}>
            <Text style={styles.phoneText} numberOfLines={1}>
              {phone}
            </Text>
          </View>

          <Text style={styles.metaText}>Risk {item.risk_level} • {item.report_count} reports</Text>

          {postCount > 0 ? <Text style={styles.postMetaText}>{postCount} linked post{postCount > 1 ? "s" : ""}</Text> : null}

          {hasStatusRow ? (
            <View style={styles.statusRow}>
              {isBlocked ? <StatusChip label="Blocked" tone="danger" /> : null}
              {item.my_reported ? <StatusChip label="Reported" tone="warning" /> : null}
              {item.in_history ? <StatusChip label="History" tone="neutral" /> : null}
            </View>
          ) : null}
        </View>

        <View style={styles.rightColumn}>
          {isHighlyReported ? <HighlyReportedBadge /> : <View style={styles.badgeSpacer} />}

          <View style={styles.actionIcons}>
            {postCount > 0 ? (
              <ActionIconButton
                icon="eye-outline"
                variant="neutral"
                onPress={() => onViewPosts?.()}
                disabled={!onViewPosts}
                accessibilityLabel={postCount <= 1 ? "View post" : `View ${postCount} posts`}
              />
            ) : null}
            <ActionIconButton
              icon={isBlocked ? "lock-open-outline" : "lock-closed-outline"}
              variant="accent"
              onPress={() => (isBlocked ? onUnblock(phone) : onBlock(phone))}
              busy={busyAction === "block" || busyAction === "unblock"}
              disabled={!!busyAction && busyAction !== "block" && busyAction !== "unblock"}
              accessibilityLabel={isBlocked ? "Unblock number" : "Block number"}
            />
            <ActionIconButton
              icon="warning-outline"
              variant="warning"
              onPress={() => onReport(phone)}
              busy={busyAction === "report"}
              disabled={!!busyAction && busyAction !== "report"}
              accessibilityLabel="Report number"
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    alignSelf: "stretch",
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#1B2538",
    backgroundColor: "#111827",
  },
  cardPressed: {
    opacity: 0.92,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    minHeight: 28,
    justifyContent: "center",
  },
  phoneText: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    color: "#F8FAFC",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  rightColumn: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    marginLeft: 8,
    minWidth: 104,
  },
  badgePill: {
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(245, 158, 11, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: 132,
  },
  badgeText: {
    color: "#FCD34D",
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  badgeSpacer: {
    minHeight: 28,
  },
  metaText: {
    marginTop: 5,
    color: "#94A3B8",
    fontSize: 13,
    lineHeight: 18,
  },
  postMetaText: {
    marginTop: 5,
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "800",
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 9,
  },
  statusChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusChipNeutral: {
    backgroundColor: "#0F172A",
    borderColor: "#243047",
  },
  statusChipWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderColor: "rgba(245, 158, 11, 0.18)",
  },
  statusChipDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.14)",
    borderColor: "rgba(239, 68, 68, 0.18)",
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  statusChipTextNeutral: {
    color: "#CBD5E1",
  },
  statusChipTextWarning: {
    color: "#FCD34D",
  },
  statusChipTextDanger: {
    color: "#FCA5A5",
  },
  actionIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
});