import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

type Mode = "menu" | "check" | "block" | "report";
type Category = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

export type BlockReportBottomSheetRef = {
  open: (args?: { mode?: Mode; phone?: string; title?: string }) => void;
  close: () => void;
};

type Props = {
  onCheck: (phone: string) => void;
  onBlock: (phone: string) => Promise<void> | void;
  onReport: (payload: { phone: string; category: Category; note?: string }) => Promise<void> | void;
};

function normalize(raw: string) {
  const digits = String(raw || "").trim().replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) return `66${digits.slice(1)}`;
  return digits;
}

export const BlockReportBottomSheet = forwardRef<BlockReportBottomSheetRef, Props>((props, ref) => {
  const { onCheck, onBlock, onReport } = props;
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [title, setTitle] = useState("Quick Actions");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<Category>("SCAM");
  const translateY = useRef(new Animated.Value(Dimensions.get("window").height)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, {
        toValue: Dimensions.get("window").height,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      setMode("menu");
      setNote("");
    });
  }, [overlayOpacity, translateY]);

  const open = useCallback((args?: { mode?: Mode; phone?: string; title?: string }) => {
    setMode(args?.mode ?? "menu");
    setTitle(args?.title ?? "Quick Actions");
    setPhone(args?.phone ?? "");
    setVisible(true);

    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [overlayOpacity, translateY]);

  useImperativeHandle(ref, () => ({ open, close }), [open, close]);

  const normalized = useMemo(() => normalize(phone), [phone]);

  const submit = useCallback(async () => {
    if (!normalized) return;
    if (mode === "check") {
      onCheck(normalized);
      close();
      return;
    }
    if (mode === "block") {
      await onBlock(normalized);
      close();
      return;
    }
    if (mode === "report") {
      await onReport({
        phone: normalized,
        category,
        note: note.trim() ? note.trim() : undefined,
      });
      close();
    }
  }, [category, close, mode, normalized, note, onBlock, onCheck, onReport]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}> 
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={close} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </Pressable>
          </View>

          {mode === "menu" ? (
            <View style={styles.menuList}>
              <MenuButton label="Add / Check number" icon="search-outline" onPress={() => setMode("check")} />
              <MenuButton label="Block number" icon="lock-closed-outline" onPress={() => setMode("block")} />
              <MenuButton label="Report number" icon="megaphone-outline" onPress={() => setMode("report")} />
            </View>
          ) : (
            <>
              <Text style={styles.label}>Phone number</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="0988264820"
                placeholderTextColor="#6b7280"
                keyboardType="phone-pad"
                style={styles.input}
              />
              <Text style={styles.hint}>{normalized ? `Normalized: ${normalized}` : "Enter a valid phone number"}</Text>

              {mode === "report" ? (
                <>
                  <Text style={[styles.label, { marginTop: 14 }]}>Report category</Text>
                  <View style={styles.categoryRow}>
                    {(["SPAM", "SCAM", "SALES", "HARASS", "OTHER"] as Category[]).map((value) => {
                      const active = category === value;
                      return (
                        <Pressable key={value} onPress={() => setCategory(value)} style={[styles.categoryChip, active && styles.categoryChipOn]}>
                          <Text style={[styles.categoryChipText, active && styles.categoryChipTextOn]}>{value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.label, { marginTop: 14 }]}>Note</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Optional note"
                    placeholderTextColor="#6b7280"
                    multiline
                    style={[styles.input, styles.noteInput]}
                  />
                </>
              ) : null}

              <Pressable onPress={() => void submit()} disabled={!normalized} style={[styles.primaryBtn, !normalized && styles.primaryBtnDisabled]}>
                <Text style={styles.primaryBtnText}>{mode === "check" ? "Check" : mode === "block" ? "Block" : "Report"}</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

function MenuButton(props: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.menuBtn}>
      <Ionicons name={props.icon as any} size={18} color="#f8fafc" />
      <Text style={styles.menuBtnText}>{props.label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#0b1020",
    borderWidth: 1,
    borderColor: "#18213e",
  },
  handle: { width: 42, height: 5, borderRadius: 999, backgroundColor: "#334155", alignSelf: "center", marginBottom: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "900" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#121a30" },
  menuList: { gap: 10 },
  menuBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  menuBtnText: { flex: 1, color: "#fff", fontWeight: "800" },
  label: { color: "#cbd5e1", fontWeight: "800", marginBottom: 8 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: { minHeight: 90, textAlignVertical: "top" },
  hint: { color: "#94a3b8", marginTop: 8 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
  },
  categoryChipOn: { backgroundColor: "#facc15", borderColor: "#facc15" },
  categoryChipText: { color: "#e2e8f0", fontWeight: "800", fontSize: 12 },
  categoryChipTextOn: { color: "#111", fontWeight: "900" },
  primaryBtn: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#34d399",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#111", fontWeight: "900" },
});