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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "react-native-vector-icons/Ionicons";

export type ReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

export type BlockSheetOpenPayload = {
  tel: string;
  postId?: string;
  title?: string;
  source?: "HOME" | "DETAIL" | "MODAL" | "INCOMING_CALL";
  reportCount?: number;
  riskScore?: number; // 0-100 (optional)
};

export type BottomSheetBlockReportModalRef = {
  open: (payload: BlockSheetOpenPayload) => void;
  close: () => void;
};

type Props = {
  isBlocked: (telNormalized: string) => boolean;
  onBlock: (telNormalized: string, meta?: { postId?: string }) => Promise<void> | void;
  onUnblock: (telNormalized: string, meta?: { postId?: string }) => Promise<void> | void;
  onReport?: (data: {
    tel: string;
    category: ReportCategory;
    note?: string;
    postId?: string;
  }) => Promise<void> | void;
};

const DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel

function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
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

export const BottomSheetBlockReportModal = forwardRef<
  BottomSheetBlockReportModalRef,
  Props
>((props, ref) => {
  const { isBlocked, onBlock, onUnblock, onReport } = props;

  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<BlockSheetOpenPayload | null>(null);

  const [wantReport, setWantReport] = useState(true);
  const [category, setCategory] = useState<ReportCategory>("SCAM");
  const [note, setNote] = useState("");
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const screenH = Dimensions.get("window").height;
  const translateY = useRef(new Animated.Value(screenH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const blockedNow = useMemo(() => {
    const tel = payload?.tel ? normalizeTel(payload.tel) : "";
    return tel ? isBlocked(tel) : false;
  }, [payload?.tel, isBlocked]);

  const risk = useMemo(() => {
    return computeRiskLabel(payload?.reportCount, payload?.riskScore);
  }, [payload?.reportCount, payload?.riskScore]);

  const open = useCallback(
    async (p: BlockSheetOpenPayload) => {
      const tel = normalizeTel(p.tel);
      if (!tel) return;

      const skipKey = DONT_ASK_PREFIX + tel;
      const skip = (await AsyncStorage.getItem(skipKey)) === "1";
      if (skip) {
        // fast mode: ไม่ต้องถามอีก -> ทำทันที
        try {
          if (isBlocked(tel)) await onUnblock(tel, { postId: p.postId });
          else await onBlock(tel, { postId: p.postId });
        } catch {
          // ignore
        }
        return;
      }

      setPayload({ ...p, tel });
      setWantReport(true);
      setCategory("SCAM");
      setNote("");
      setDontAskAgain(false);

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
    [overlayOpacity, translateY, isBlocked, onBlock, onUnblock]
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

  const primaryText = useMemo(() => {
    if (blockedNow) return "ยกเลิกบล็อก";
    if (!onReport || !wantReport) return "บล็อก";
    return "บล็อก + รายงาน";
  }, [blockedNow, onReport, wantReport]);

  const riskTone = toneStyle(risk.tone);

  const onConfirm = useCallback(async () => {
    if (!payload?.tel) return;
    const tel = normalizeTel(payload.tel);
    if (!tel) return;

    setBusy(true);
    try {
      if (dontAskAgain) {
        await AsyncStorage.setItem(DONT_ASK_PREFIX + tel, "1");
      }

      if (blockedNow) {
        await onUnblock(tel, { postId: payload.postId });
        close();
        return;
      }

      await onBlock(tel, { postId: payload.postId });

      if (onReport && wantReport) {
        await onReport({
          tel,
          category,
          note: note.trim() ? note.trim() : undefined,
          postId: payload.postId,
        });
      }

      close();
    } finally {
      setBusy(false);
    }
  }, [
    payload,
    blockedNow,
    onBlock,
    onUnblock,
    onReport,
    wantReport,
    category,
    note,
    dontAskAgain,
    close,
  ]);

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

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.hTitle}>
                {blockedNow ? "จัดการเบอร์ที่บล็อกไว้" : "ก่อนบล็อก… ช่วยยืนยันหน่อย"}
              </Text>

              <View style={styles.telRow}>
                <Ionicons name="call-outline" size={16} color="#9ca3af" />
                <Text style={styles.telText}>{payload?.tel ?? "-"}</Text>

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
            </View>

            <TouchableOpacity onPress={close} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </TouchableOpacity>
          </View>

          {!blockedNow && !!onReport ? (
            <TouchableOpacity
              onPress={() => setWantReport((v) => !v)}
              style={styles.toggleRow}
              activeOpacity={0.88}
            >
              <View style={[styles.checkBox, wantReport && styles.checkBoxOn]}>
                {wantReport ? (
                  <Ionicons name="checkmark" size={14} color="#111" />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Report to help others</Text>
                <Text style={styles.toggleDesc} numberOfLines={2}>
                  เลือกหมวด + ใส่โน้ตสั้น ๆ (ไม่บังคับ)
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {!blockedNow && wantReport && !!onReport ? (
            <>
              <View style={styles.chipsWrap}>
                <Chip label="Spam" icon="alert-circle-outline" active={category === "SPAM"} onPress={() => setCategory("SPAM")} />
                <Chip label="Scam" icon="warning-outline" active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
                <Chip label="Sales/Ads" icon="pricetag-outline" active={category === "SALES"} onPress={() => setCategory("SALES")} />
                <Chip label="Harassment" icon="hand-left-outline" active={category === "HARASS"} onPress={() => setCategory("HARASS")} />
                <Chip label="Other" icon="ellipsis-horizontal" active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.label}>Note (optional)</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="เช่น โทรขายของ / หลอกโอน / ทวงหนี้ / ก่อกวน..."
                  placeholderTextColor="#6b7280"
                  style={styles.input}
                  maxLength={120}
                  multiline
                />
                <Text style={styles.counter}>{note.length}/120</Text>
              </View>
            </>
          ) : null}

          <TouchableOpacity
            onPress={() => setDontAskAgain((v) => !v)}
            style={styles.toggleRow2}
            activeOpacity={0.85}
          >
            <View style={[styles.checkBox, dontAskAgain && styles.checkBoxOn]}>
              {dontAskAgain ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
            </View>
            <Text style={styles.toggleTitle2}>ไม่ต้องถามอีกสำหรับเบอร์นี้</Text>
          </TouchableOpacity>

          <View style={styles.actions}>
            <TouchableOpacity onPress={close} style={[styles.btn, styles.btnGhost]} disabled={busy}>
              <Text style={styles.btnGhostText}>ยกเลิก</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onConfirm}
              style={[
                styles.btn,
                blockedNow ? styles.btnUnblock : styles.btnPrimary,
                busy && { opacity: 0.7 },
              ]}
              disabled={busy}
            >
              <View style={styles.btnRow}>
                <Ionicons
                  name={blockedNow ? "lock-open-outline" : "lock-closed"}
                  size={16}
                  color={blockedNow ? "#e5e7eb" : "#111"}
                />
                <Text style={[styles.btnPrimaryText, { color: blockedNow ? "#e5e7eb" : "#111" }]}>
                  {busy ? "กำลังทำรายการ..." : primaryText}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            ทริค: ถ้ากดพลาด คุณสามารถไปแท็บ Blocked เพื่อยกเลิกบล็อกได้ตลอด
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
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
  telRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  telText: { color: "#e5e7eb", fontSize: 15, fontWeight: "900" },
  riskPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  riskPillText: { fontSize: 11, fontWeight: "900" },
  reportCount: { color: "#9ca3af", fontSize: 12, fontWeight: "800" },
  subtle: { color: "#9ca3af", fontSize: 12, marginTop: 6 },

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

  toggleRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  toggleTitle: { color: "#fff", fontSize: 13, fontWeight: "900" },
  toggleDesc: { color: "#9ca3af", fontSize: 12, marginTop: 2, lineHeight: 16 },

  toggleRow2: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 6,
  },
  toggleTitle2: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkBoxOn: { backgroundColor: "#34c759", borderColor: "#34c759" },

  chipsWrap: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
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

  label: { color: "#9ca3af", fontSize: 12, fontWeight: "900", marginBottom: 6 },
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

  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  btnGhostText: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  btnPrimary: { backgroundColor: "#34c759" },
  btnUnblock: { backgroundColor: "#111116", borderWidth: 1, borderColor: "#2a2a35" },

  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimaryText: { fontSize: 13, fontWeight: "900", color: "#111" },

  hint: { marginTop: 10, color: "#6b7280", fontSize: 11, lineHeight: 15 },
});
