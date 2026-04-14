import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import type { PhoneActionItem } from "../hooks/usePhoneActions";

type Props = {
  visible: boolean;
  item: PhoneActionItem | null;
  onBlock: () => void;
  onReport: () => void;
  onIgnore: () => void;
  busyAction?: "block" | "report" | null;
};

export function AfterCallPopup(props: Props) {
  const { visible, item, onBlock, onReport, onIgnore, busyAction } = props;
  if (!visible || !item) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onIgnore}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onIgnore} />
        <View style={styles.sheet}>
          <Text style={styles.alert}>This number may be a scam</Text>
          <Text style={styles.phone}>{item.phone_normalized || item.phone}</Text>
          <Text style={styles.meta}>Risk {item.risk_level} • {item.report_count} reports</Text>

          <View style={styles.actions}>
            <Pressable onPress={onBlock} style={[styles.btn, styles.blockBtn]} disabled={!!busyAction}>
              {busyAction === "block" ? <ActivityIndicator size="small" color="#111" /> : <Text style={styles.btnTextDark}>{item.my_blocked ? "Blocked" : "Block"}</Text>}
            </Pressable>

            <Pressable onPress={onReport} style={[styles.btn, styles.reportBtn]} disabled={!!busyAction}>
              {busyAction === "report" ? <ActivityIndicator size="small" color="#111" /> : <Text style={styles.btnTextDark}>Report</Text>}
            </Pressable>

            <Pressable onPress={onIgnore} style={[styles.btn, styles.ignoreBtn]} disabled={!!busyAction}>
              <Text style={styles.btnTextLight}>Ignore</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: {
    margin: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "#0b1020",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  alert: { color: "#fb7185", fontSize: 18, fontWeight: "900" },
  phone: { color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 8 },
  meta: { color: "#94a3b8", marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  blockBtn: { backgroundColor: "#fb7185" },
  reportBtn: { backgroundColor: "#facc15" },
  ignoreBtn: { backgroundColor: "#111827", borderWidth: 1, borderColor: "#334155" },
  btnTextDark: { color: "#111", fontWeight: "900" },
  btnTextLight: { color: "#fff", fontWeight: "900" },
});