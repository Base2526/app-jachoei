import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  Animated,
  Easing,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
  Alert,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

export type BankReportCategory =
  | "SCAM"
  | "MONEY_MULE"
  | "SALES_ADS"
  | "DISPUTE"
  | "OTHER";

export type BankReportOpenPayload = {
  bankName?: string | null;
  account: string; // raw
  postId?: string;
  title?: string;
  source?: "HOME" | "DETAIL" | "MODAL";
  reportCount?: number; // optional
  riskScore?: number; // optional 0-100
};

export type BottomSheetReportBankModalRef = {
  open: (payload: BankReportOpenPayload) => void;
  close: () => void;
};

type Props = {
  isReported?: (accountNormalized: string) => boolean; // optional UI
  onMarkReported?: (accountNormalized: string) => void; // optional UI

  onReport: (data: {
    bankName?: string | null;
    account: string; // normalized
    category: BankReportCategory;
    note?: string;
    postId?: string;
  }) => Promise<void> | void;
};

function normalizeBankAccount(raw: string) {
  // keep digits only
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function computeRiskLabel(reportCount?: number, riskScore?: number) {
  const c = reportCount ?? 0;
  const s = typeof riskScore === "number" ? riskScore : -1;

  if (s >= 0) {
    if (s >= 80) return { label: "HIGH RISK", tone: "danger" as const };
    if (s >= 45) return { label: "MEDIUM", tone: "warn" as const };
    return { label: "LOW", tone: "muted" as const };
  }

  if (c >= 20) return { label: "HIGH RISK", tone: "danger" as const };
  if (c >= 5) return { label: "MEDIUM", tone: "warn" as const };
  return { label: "LOW", tone: "muted" as const };
}

function toneStyle(tone: "danger" | "warn" | "muted") {
  switch (tone) {
    case "danger":
      return { bg: "#ef4444", fg: "#111" };
    case "warn":
      return { bg: "#facc15", fg: "#111" };
    default:
      return { bg: "#374151", fg: "#fff" };
  }
}

export const BottomSheetReportBankModal = forwardRef<
  BottomSheetReportBankModalRef,
  Props
>((props, ref) => {
  const { onReport, isReported, onMarkReported } = props;

  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<BankReportOpenPayload | null>(null);

  const [category, setCategory] = useState<BankReportCategory>("SCAM");
  const [note, setNote] = useState("");
  const [rememberReported, setRememberReported] = useState(true);

  const screenH = Dimensions.get("window").height;
  const translateY = useRef(new Animated.Value(screenH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const normalizedAccount = useMemo(() => {
    const a = payload?.account ? normalizeBankAccount(payload.account) : "";
    return a;
  }, [payload?.account]);

  const reportedAlready = useMemo(() => {
    if (!isReported) return false;
    if (!normalizedAccount) return false;
    return !!isReported(normalizedAccount);
  }, [isReported, normalizedAccount]);

  const risk = useMemo(() => {
    return computeRiskLabel(payload?.reportCount, payload?.riskScore);
  }, [payload?.reportCount, payload?.riskScore]);

  const open = useCallback(
    (p: BankReportOpenPayload) => {
      const acc = normalizeBankAccount(p.account);
      if (!acc) return;

      setPayload({ ...p, account: acc });
      setCategory("SCAM");
      setNote("");
      setRememberReported(true);

      setVisible(true);

      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    },
    [overlayOpacity, translateY]
  );

  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: screenH,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setVisible(false);
        setPayload(null);
        setBusy(false);
      }
    });
  }, [overlayOpacity, translateY, screenH]);

  useImperativeHandle(ref, () => ({ open, close }), [open, close]);

  const riskTone = toneStyle(risk.tone);

  const onSubmit = useCallback(async () => {
    if (!payload) return;
    const acc = normalizeBankAccount(payload.account);
    if (!acc) return;

    setBusy(true);
    try {
      await onReport({
        bankName: payload.bankName ?? null,
        account: acc,
        category,
        note: note.trim() ? note.trim() : undefined,
        postId: payload.postId,
      });

      // optional local mark
      if (rememberReported && onMarkReported) {
        onMarkReported(acc);
      }

      close();
      Alert.alert("ส่งรายงานแล้ว", "ขอบคุณที่ช่วยกันทำให้ระบบแม่นขึ้น 🙏");
    } catch (e: any) {
      Alert.alert("ส่งรายงานไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }, [payload, category, note, rememberReported, onReport, onMarkReported, close]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kbWrap}
      >
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hTitle}>รายงานบัญชีธนาคาร</Text>

              <View style={styles.row}>
                <Ionicons name="card-outline" size={16} color="#9ca3af" />
                <Text style={styles.accText} numberOfLines={1}>
                  {payload?.bankName ? `${payload.bankName} • ` : ""}
                  {normalizedAccount || "-"}
                </Text>

                <View style={[styles.riskPill, { backgroundColor: riskTone.bg }]}>
                  <Text style={[styles.riskPillText, { color: riskTone.fg }]}>
                    {risk.label}
                  </Text>
                </View>

                {typeof payload?.reportCount === "number" ? (
                  <Text style={styles.reportCount}>• {payload.reportCount} reports</Text>
                ) : null}
              </View>

              {payload?.title ? (
                <Text style={styles.subtle} numberOfLines={1}>
                  จากโพสต์: {payload.title}
                </Text>
              ) : null}

              {reportedAlready ? (
                <Text style={styles.reportedHint} numberOfLines={1}>
                  ✓ คุณเคยรายงานบัญชีนี้แล้ว (ในเครื่อง)
                </Text>
              ) : null}
            </View>

            <TouchableOpacity onPress={close} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </TouchableOpacity>
          </View>

          {/* Category */}
          <Text style={styles.label}>หมวดรายงาน</Text>
          <View style={styles.chipsWrap}>
            <Chip
              label="Scam"
              icon="warning-outline"
              active={category === "SCAM"}
              onPress={() => setCategory("SCAM")}
            />
            <Chip
              label="Money Mule"
              icon="swap-horizontal-outline"
              active={category === "MONEY_MULE"}
              onPress={() => setCategory("MONEY_MULE")}
            />
            <Chip
              label="Sales/Ads"
              icon="pricetag-outline"
              active={category === "SALES_ADS"}
              onPress={() => setCategory("SALES_ADS")}
            />
            <Chip
              label="Dispute"
              icon="chatbox-ellipses-outline"
              active={category === "DISPUTE"}
              onPress={() => setCategory("DISPUTE")}
            />
            <Chip
              label="Other"
              icon="ellipsis-horizontal"
              active={category === "OTHER"}
              onPress={() => setCategory("OTHER")}
            />
          </View>

          {/* Note */}
          <View style={{ marginTop: 10 }}>
            <Text style={styles.label}>รายละเอียด (ไม่บังคับ)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="เช่น หลอกโอน / ไม่ส่งของ / ใช้บัญชีรับโอน / ทวงเงิน..."
              placeholderTextColor="#6b7280"
              style={styles.input}
              maxLength={160}
              multiline
            />
            <Text style={styles.counter}>{note.length}/160</Text>
          </View>

          {/* remember */}
          <TouchableOpacity
            onPress={() => setRememberReported((v) => !v)}
            style={styles.rememberRow}
            activeOpacity={0.85}
          >
            <View style={[styles.checkBox, rememberReported && styles.checkBoxOn]}>
              {rememberReported ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
            </View>
            <Text style={styles.rememberText}>จำว่าเคยรายงานแล้ว (ในเครื่อง)</Text>
          </TouchableOpacity>

          {/* actions */}
          <View style={styles.actions}>
            <TouchableOpacity onPress={close} style={[styles.btn, styles.btnGhost]} disabled={busy}>
              <Text style={styles.btnGhostText}>ยกเลิก</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.7 }]}
              disabled={busy}
            >
              <View style={styles.btnRow}>
                <Ionicons name="megaphone-outline" size={16} color="#111" />
                <Text style={styles.btnPrimaryText}>
                  {busy ? "กำลังส่ง..." : "Report"}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            รายงาน = ส่งข้อมูลให้ระบบ/แอดมินตรวจสอบ (ไม่มีผล block ในเครื่อง)
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

function Chip(props: { label: string; icon: string; active?: boolean; onPress: () => void }) {
  const { label, icon, active, onPress } = props;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn]}
      activeOpacity={0.9}
    >
      <Ionicons name={icon as any} size={14} color={active ? "#111" : "#e5e7eb"} />
      <Text style={[styles.chipText, active && { color: "#111" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  kbWrap: { flex: 1, justifyContent: "flex-end" },

  sheet: {
    backgroundColor: "#0f0f14",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "#1f1f26",
    padding: 14,
    paddingBottom: 16,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#2a2a35",
    marginBottom: 10,
  },

  header: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f26",
  },
  hTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },

  row: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  accText: { flex: 1, color: "#e5e7eb", fontSize: 14, fontWeight: "900" },

  riskPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  riskPillText: { fontSize: 11, fontWeight: "900" },
  reportCount: { color: "#9ca3af", fontSize: 12, fontWeight: "800" },

  subtle: { color: "#9ca3af", fontSize: 12, marginTop: 6 },
  reportedHint: { color: "#34c759", fontSize: 12, marginTop: 4, fontWeight: "900" },

  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },

  label: { color: "#9ca3af", fontSize: 12, fontWeight: "900", marginTop: 12 },

  chipsWrap: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  chipOn: { backgroundColor: "#34c759", borderColor: "#34c759" },
  chipText: { color: "#e5e7eb", fontSize: 12, fontWeight: "900" },

  input: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1f1f26",
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 18,
  },
  counter: { color: "#6b7280", fontSize: 11, marginTop: 6, textAlign: "right" },

  rememberRow: { marginTop: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  checkBoxOn: { backgroundColor: "#34c759", borderColor: "#34c759" },
  rememberText: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },

  btnGhost: { backgroundColor: "#1d1d25", borderWidth: 1, borderColor: "#2a2a35" },
  btnGhostText: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  btnPrimary: { backgroundColor: "#34c759" },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimaryText: { fontSize: 13, fontWeight: "900", color: "#111" },

  hint: { marginTop: 10, color: "#6b7280", fontSize: 11, lineHeight: 15 },
});
