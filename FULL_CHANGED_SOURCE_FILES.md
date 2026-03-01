# Full changed source files
- Repo: `/Users/s0mkidd/Desktop/Projects/app-jachoei/MyApp`
- Git HEAD: `da218fe`
- Generated (UTC): `2026-03-01T02:33:08.792528+00:00`
- Extensions: `js, jsx, ts, tsx`

## src/components/BottomSheetBlockReportModal.tsx

```tsx
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
  initialWantReport?: boolean;
  initialCategory?: ReportCategory;
  initialNote?: string;
};

export type BottomSheetBlockReportModalRef = {
  open: (payload: BlockSheetOpenPayload) => void;
  close: () => void;
};

type Props = {
  isBlocked: (telNormalized: string) => boolean;
  onConfirm: (data: {
    tel: string;
    postId?: string;
    title?: string;
    source?: "HOME" | "DETAIL" | "MODAL" | "INCOMING_CALL";
    wantReport: boolean;
    category: ReportCategory;
    note: string;
    dontAskAgain: boolean;
  }) => Promise<void> | void;
  onUndo: (data: {
    tel: string;
    postId?: string;
    title?: string;
    source?: "HOME" | "DETAIL" | "MODAL" | "INCOMING_CALL";
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
  const { isBlocked, onConfirm, onUndo } = props;

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

      // fast mode: skip only for blocking (not for managing already-blocked)
      if (skip && !isBlocked(tel)) {
        try {
          await onConfirm({
            tel,
            postId: p.postId,
            title: p.title,
            source: p.source,
            wantReport: true,
            category: "SCAM",
            note: "",
            dontAskAgain: true,
          });
        } catch {
          // ignore
        }
        return;
      }

      setPayload({ ...p, tel });
      setWantReport(p.initialWantReport ?? true);
      setCategory(p.initialCategory ?? "SCAM");
      setNote(p.initialNote ?? "");
      setDontAskAgain(skip);

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
    [overlayOpacity, translateY, isBlocked, onConfirm]
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
    if (blockedNow) return "Update Report";
    if (!wantReport) return "บล็อก";
    return "บล็อก + รายงาน";
  }, [blockedNow, wantReport]);

  const riskTone = toneStyle(risk.tone);

  const onPrimary = useCallback(async () => {
    if (!payload?.tel) return;
    const tel = normalizeTel(payload.tel);
    if (!tel) return;

    setBusy(true);
    try {
      if (dontAskAgain) {
        await AsyncStorage.setItem(DONT_ASK_PREFIX + tel, "1");
      }

      await onConfirm({
        tel,
        postId: payload.postId,
        title: payload.title,
        source: payload.source,
        wantReport,
        category,
        note,
        dontAskAgain,
      });

      close();
    } finally {
      setBusy(false);
    }
  }, [
    payload,
    blockedNow,
    onConfirm,
    wantReport,
    category,
    note,
    dontAskAgain,
    close,
  ]);

  const onUnblock = useCallback(async () => {
    if (!payload?.tel) return;
    const tel = normalizeTel(payload.tel);
    if (!tel) return;

    setBusy(true);
    try {
      await onUndo({
        tel,
        postId: payload.postId,
        title: payload.title,
        source: payload.source,
      });
      close();
    } finally {
      setBusy(false);
    }
  }, [payload, onUndo, close]);

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

          <TouchableOpacity
            onPress={() => setWantReport((v) => !v)}
            style={styles.toggleRow}
            activeOpacity={0.88}
          >
            <View style={[styles.checkBox, wantReport && styles.checkBoxOn]}>
              {wantReport ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Report to help others</Text>
              <Text style={styles.toggleDesc} numberOfLines={2}>
                เลือกหมวด + ใส่โน้ตสั้น ๆ (ไม่บังคับ)
              </Text>
            </View>
          </TouchableOpacity>

          {wantReport ? (
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

            {blockedNow ? (
              <TouchableOpacity
                onPress={onUnblock}
                style={[styles.btn, styles.btnUnblock, busy && { opacity: 0.7 }]}
                disabled={busy}
              >
                <View style={styles.btnRow}>
                  <Ionicons name="lock-open-outline" size={16} color="#e5e7eb" />
                  <Text style={[styles.btnPrimaryText, { color: "#e5e7eb" }]}>ยกเลิกบล็อก</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              onPress={onPrimary}
              style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.7 }]}
              disabled={busy}
            >
              <View style={styles.btnRow}>
                <Ionicons name={blockedNow ? ("save" as any) : "lock-closed"} size={16} color="#111" />
                <Text style={[styles.btnPrimaryText, { color: "#111" }]}>
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
```

## src/components/BottomSheetReportBankModal.tsx

```tsx
// src/components/BottomSheetReportBankModal.tsx
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

export type BankCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type BottomSheetReportBankModalOpenArgs = {
  bankName: string | null;
  account: string;            // normalized digits
  initialCategory?: BankCategory;
  initialNote?: string;
  postId?: string;
  title?: string;
  source?: "HOME" | "MODAL";
};

export type BottomSheetReportBankModalRef = {
  open: (args: BottomSheetReportBankModalOpenArgs) => void;
  close: () => void;
};

type Props = {
  isReported: (accNormalized: string) => boolean;

  onConfirm: (payload: {
    bankName: string | null;
    account: string;
    category: BankCategory;
    note: string;
    postId?: string;
    title?: string;
    source?: "HOME" | "MODAL";
  }) => Promise<void>;

  onUndo: (payload: {
    bankName: string | null;
    account: string;
  }) => Promise<void>;
};

export const BottomSheetReportBankModal = forwardRef<BottomSheetReportBankModalRef, Props>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    const [bankName, setBankName] = useState<string | null>(null);
    const [account, setAccount] = useState<string>("");

    const [postId, setPostId] = useState<string | undefined>(undefined);
    const [title, setTitle] = useState<string | undefined>(undefined);
    const [source, setSource] = useState<"HOME" | "MODAL">("HOME");

    const [category, setCategory] = useState<BankCategory>("SCAM");
    const [note, setNote] = useState<string>("");

    const [busy, setBusy] = useState(false);

    const reported = useMemo(() => {
      return account ? props.isReported(account) : false;
    }, [account, props]);

    useImperativeHandle(ref, () => ({
      open: (args) => {
        setBankName(args.bankName ?? null);
        setAccount(args.account);
        setPostId(args.postId);
        setTitle(args.title);
        setSource(args.source ?? "HOME");
        setCategory(args.initialCategory ?? "SCAM");
        setNote(args.initialNote ?? "");
        setVisible(true);
      },
      close: () => setVisible(false),
    }));

    const onClose = () => setVisible(false);

    const onSubmit = async () => {
      if (!account) return;

      setBusy(true);
      try {
        await props.onConfirm({
          bankName,
          account,
          category,
          note,
          postId,
          title,
          source,
        });
        setVisible(false);
      } finally {
        setBusy(false);
      }
    };

    const onUndo = async () => {
      if (!account) return;
      setBusy(true);
      try {
        await props.onUndo({ bankName, account });
        setVisible(false);
      } finally {
        setBusy(false);
      }
    };

    if (!visible) return null;

    const primaryLabel = reported ? "Update Report" : "Report";
    const primaryIcon = reported ? "save" : "megaphone";
    const primaryStyle = styles.primary;

    return (
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.hTitle}>รายงานบัญชีธนาคาร</Text>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </TouchableOpacity>
          </View>

          <Text style={styles.accLine}>
            {bankName ? `${bankName} · ` : ""}{account}
          </Text>

          {reported ? (
            <Text style={styles.reportedText}>
              ✓ คุณเคยรายงานบัญชีนี้แล้ว (ในเครื่อง)
            </Text>
          ) : (
            <Text style={styles.hintText}>
              รายงานนี้จะส่งข้อมูลให้ระบบ/แอดมินตรวจสอบ (ไม่บล็อกในเครื่อง)
            </Text>
          )}

          <View style={styles.divider} />

          <Text style={styles.section}>หมวดรายงาน</Text>
          <View style={styles.catRow}>
            <CatBtn label="Scam" active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
            <CatBtn label="Money Mule" active={category === "MONEY_MULE"} onPress={() => setCategory("MONEY_MULE")} />
            <CatBtn label="Sales/Ads" active={category === "SALES_ADS"} onPress={() => setCategory("SALES_ADS")} />
            <CatBtn label="Dispute" active={category === "DISPUTE"} onPress={() => setCategory("DISPUTE")} />
            <CatBtn label="Other" active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
          </View>

          <Text style={[styles.section, { marginTop: 14 }]}>รายละเอียด (ไม่บังคับ)</Text>
          <View style={styles.noteBox}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="เช่น หลอกโอน / ใช้บัญชีรับโอน / ฯลฯ"
              placeholderTextColor="#6b7280"
              style={styles.noteInput}
              maxLength={160}
              multiline
            />
            <Text style={styles.counter}>{note.length}/160</Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
              <Text style={styles.cancelText}>ยกเลิก</Text>
            </TouchableOpacity>

            {reported ? (
              <TouchableOpacity style={[styles.primaryBtn, styles.primaryDanger]} onPress={onUndo} disabled={busy}>
                <Ionicons name={"close-circle" as any} size={16} color="#111" />
                <Text style={styles.primaryText}>{busy ? "..." : "Undo report"}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={[styles.primaryBtn, primaryStyle]} onPress={onSubmit} disabled={busy}>
              <Ionicons name={primaryIcon as any} size={16} color="#111" />
              <Text style={styles.primaryText}>{busy ? "..." : primaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }
);

function CatBtn(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={props.onPress} style={[styles.catBtn, props.active && styles.catBtnActive]}>
      <Text style={[styles.catText, props.active && styles.catTextActive]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#111116",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "#2a2a35",
    padding: 14,
  },
  header: { flexDirection: "row", alignItems: "center" },
  hTitle: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "900" },
  closeBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "#1d1d25",
    borderWidth: 1, borderColor: "#2a2a35",
    alignItems: "center", justifyContent: "center",
  },

  accLine: { marginTop: 10, color: "#e5e7eb", fontSize: 14, fontWeight: "900" },
  reportedText: { marginTop: 6, color: "#34c759", fontSize: 12, fontWeight: "900" },
  hintText: { marginTop: 6, color: "#9ca3af", fontSize: 12, fontWeight: "800" },

  divider: { marginTop: 12, height: 1, backgroundColor: "#1f1f26" },

  section: { marginTop: 12, color: "#9ca3af", fontSize: 12, fontWeight: "900" },
  catRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  catBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1, borderColor: "#2a2a35",
  },
  catBtnActive: { borderColor: "#34c759", backgroundColor: "rgba(52,199,89,0.18)" },
  catText: { color: "#e5e7eb", fontSize: 12, fontWeight: "900" },
  catTextActive: { color: "#34c759" },

  noteBox: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#0b0b0f",
    padding: 10,
  },
  noteInput: { minHeight: 60, color: "#fff", fontSize: 13, fontWeight: "800" },
  counter: { marginTop: 6, color: "#6b7280", fontSize: 11, fontWeight: "900", alignSelf: "flex-end" },

  footer: { marginTop: 14, flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  cancelText: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  primaryBtn: {
    flex: 1.3,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primary: { backgroundColor: "#34c759" },
  primaryDanger: { backgroundColor: "#ef4444" },
  primaryText: { color: "#111", fontSize: 13, fontWeight: "900" },
});
```

## src/lib/jachoeiLocalState.ts

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BLOCKED_TEL_STORE_KEY = "jachoei.blocked_tel_v1";
export const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";

export const TEL_BLOCK_DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel

export const DEVICE_CLIENT_ID_KEY = "jachoei.device_client_id_v1";

export type TelReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
export type BankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type StoredBlockedTelEntry = {
  wantReport?: boolean;
  category?: TelReportCategory;
  note?: string;
  blockedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredReportedBankEntry = {
  bank_name?: string | null;
  category?: BankReportCategory;
  note?: string;
  reportedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredBlockedTelMap = Record<string, StoredBlockedTelEntry>;
export type StoredReportedBankMap = Record<string, StoredReportedBankEntry>;

export function normalizeTel(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeBankAccount(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function sanitizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function sanitizeBlockedTelEntry(input: unknown): StoredBlockedTelEntry {
  const base = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const wantReport = typeof base.wantReport === "boolean" ? base.wantReport : undefined;

  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SPAM" || categoryRaw === "SCAM" || categoryRaw === "SALES" || categoryRaw === "HARASS" || categoryRaw === "OTHER"
      ? (categoryRaw as TelReportCategory)
      : undefined;

  const note = typeof base.note === "string" ? base.note : undefined;
  const blockedAt = typeof base.blockedAt === "string" ? base.blockedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return { wantReport, category, note, blockedAt, ctx, tags };
}

function sanitizeReportedBankEntry(input: unknown): StoredReportedBankEntry {
  const base = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const bank_name =
    typeof base.bank_name === "string" ? base.bank_name : base.bank_name === null ? null : undefined;

  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SCAM" ||
    categoryRaw === "MONEY_MULE" ||
    categoryRaw === "SALES_ADS" ||
    categoryRaw === "DISPUTE" ||
    categoryRaw === "OTHER"
      ? (categoryRaw as BankReportCategory)
      : undefined;

  const note = typeof base.note === "string" ? base.note : undefined;
  const reportedAt = typeof base.reportedAt === "string" ? base.reportedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return { bank_name, category, note, reportedAt, ctx, tags };
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function loadBlockedTelMap(): Promise<StoredBlockedTelMap> {
  const parsed = await readJson(BLOCKED_TEL_STORE_KEY);
  const out: StoredBlockedTelMap = {};

  if (Array.isArray(parsed)) {
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeTel(v);
      if (!k) continue;
      out[k] = {};
    }
    await writeJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeTel(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeBlockedTelEntry(v);
        continue;
      }

      if (v) out[k] = {};
    }

    await writeJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  return out;
}

export async function saveBlockedTelMap(map: StoredBlockedTelMap): Promise<void> {
  await writeJson(BLOCKED_TEL_STORE_KEY, map);
}

export async function loadReportedBankMap(): Promise<StoredReportedBankMap> {
  const parsed = await readJson(REPORTED_BANK_STORE_KEY);
  const out: StoredReportedBankMap = {};

  if (Array.isArray(parsed)) {
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeBankAccount(v);
      if (!k) continue;
      out[k] = {};
    }
    await writeJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeBankAccount(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeReportedBankEntry(v);
        continue;
      }

      if (v) out[k] = {};
    }

    await writeJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  return out;
}

export async function saveReportedBankMap(map: StoredReportedBankMap): Promise<void> {
  await writeJson(REPORTED_BANK_STORE_KEY, map);
}

function genClientId(): string {
  const rand = () => Math.random().toString(16).slice(2);
  return (rand() + rand() + Date.now().toString(16) + rand()).slice(0, 32);
}

export async function getDeviceClientId(): Promise<string> {
  try {
    const existed = await AsyncStorage.getItem(DEVICE_CLIENT_ID_KEY);
    if (existed && typeof existed === "string" && existed.length > 0) return existed;
    const created = genClientId();
    await AsyncStorage.setItem(DEVICE_CLIENT_ID_KEY, created);
    return created;
  } catch {
    return genClientId();
  }
}

export function encodeBankCategoryIntoText(category: BankReportCategory | undefined, text: string | null | undefined): string | null {
  const base = (text ?? "").trim();
  if (!category) return base || null;
  const prefix = `[CATEGORY=${category}]`;
  if (!base) return prefix;
  if (base.startsWith(prefix)) return base;
  return `${prefix} ${base}`;
}
```

## src/screens/HomeScreen.tsx

```tsx
// src/screens/HomeScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Pressable,
  Dimensions,
  Platform,
  Share,
  Linking,
  Image,
  GestureResponderEvent,
  Modal
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  loadBlockedTelMap,
  saveBlockedTelMap,
  loadReportedBankMap,
  saveReportedBankMap,
  getDeviceClientId,
  encodeBankCategoryIntoText,
  type StoredBlockedTelMap,
  type StoredBlockedTelEntry,
  type StoredReportedBankMap,
  type StoredReportedBankEntry,
} from "../lib/jachoeiLocalState";

import {
  useNavigation,
  useFocusEffect,
  useRoute,
  RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThumbGrid } from "../components/ThumbGrid";
import { client } from "../apollo/client";
import { ENV } from "../config/env";

import type { RootStackParamList, TabsParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthProvider";

import {
  BottomSheetBlockReportModal,
  BottomSheetBlockReportModalRef,
} from "../components/BottomSheetBlockReportModal";

import {
  BottomSheetReportBankModal,
  BottomSheetReportBankModalRef,
} from "../components/BottomSheetReportBankModal";

// =======================
// GraphQL
// =======================
const Q_POSTS_PAGED = gql`
  query ($q: String, $limit: Int!, $offset: Int!) {
    postsPaged(search: $q, limit: $limit, offset: $offset) {
      total
      items {
        id
        title
        detail
        status
        created_at
        is_bookmarked
        images {
          id
          url
        }
        author {
          id
          name
          avatar
        }
        tel_numbers {
          id
          tel
        }
        seller_accounts {
          id
          bank_name
          seller_account
        }
        comments_count
        fb_permalink_url
        fb_status
      }
    }
  }
`;

const M_TOGGLE_BOOKMARK = gql`
  mutation ToggleBookmark($postId: ID!) {
    toggleBookmark(postId: $postId) {
      status
      isBookmarked
    }
  }
`;

const M_REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const M_UNREPORT_SCAM_BANK_ACCOUNT = gql`
  mutation UnreportScamBankAccount($input: UnreportScamBankAccountInput!) {
    unreportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const REPORT_SCAM_PHONE = gql`
  mutation ReportScamPhone($input: ReportScamPhoneInput!) {
    reportScamPhone(input: $input) {
      phone
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const UNBLOCK_SCAM_PHONE = gql`
  mutation UnblockScamPhone($input: UnblockScamPhoneInput!) {
    unblockScamPhone(input: $input) {
      phone
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

// =======================
// Types / Utils
// =======================
export type ReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

type PostItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  created_at?: string | null;

  is_bookmarked?: boolean | null;

  images?: Array<{ id: string; url: string }> | null;
  author?: { id: string; name?: string | null; avatar?: string | null } | null;

  tel_numbers?: Array<{ id: string; tel: string }> | null;
  seller_accounts?: Array<{
    id: string;
    bank_name?: string | null;
    seller_account?: string | null;
  }> | null;

  comments_count?: number | null;
  fb_permalink_url?: string | null;
  fb_status?: string | null;
};

type PostsPagedResponse = {
  postsPaged: { total: number; items: PostItem[] };
};

type PostsPagedVars = {
  q?: string | null;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 10;

// ====== Local storage ======
const BLOCKED_STORE_KEY = "jachoei.blocked_tel_v1";
const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";

function genClientId() {
  // RN-safe UUID-ish (ไม่ใช้ uuidv4 เพื่อเลี่ยง crypto.getRandomValues)
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function normalizeBankAccount(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function statusColor(status?: string | null) {
  switch ((status || "").toUpperCase()) {
    case "PENDING":
      return { fg: "#111", bg: "#facc15" };
    case "BLOCKED":
    case "BANNED":
      return { fg: "#fff", bg: "#ef4444" };
    case "VERIFIED":
    case "OK":
      return { fg: "#111", bg: "#22c55e" };
    default:
      return { fg: "#fff", bg: "#374151" };
  }
}

function isFacebookPublished(r: PostItem) {
  return (
    String(r?.fb_status ?? "").toUpperCase() === "PUBLISHED" &&
    !!r?.fb_permalink_url
  );
}

function formatDateTime(ts?: string | null) {
  if (!ts) return "";
  const n = Number(ts);
  if (!Number.isNaN(n)) return new Date(n).toLocaleString();
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  return String(ts);
}

function buildSharePayload(r: PostItem) {
  const base = ENV.webBase ?? "https://jachoei.com";
  const url = `${base}/post/${r.id}`;
  const title = r?.title ? String(r.title) : "จ่าเฉย (Jachoei)";
  const detail = r?.detail ? String(r.detail).replace(/\s+/g, " ").trim() : "";
  const text = detail
    ? `${title}\n\n${detail.slice(0, 180)}${detail.length > 180 ? "..." : ""}`
    : title;
  return { url, title, text };
}

type HomeRoute = RouteProp<TabsParamList, "HomeScreen">;


// const DEVICE_CLIENT_ID_KEY = "jachoei.device_client_id_v1";
// let _deviceClientIdCache: string | null = null;

// async function getDeviceClientId(): Promise<string> {
//   if (_deviceClientIdCache) return _deviceClientIdCache;

//   const existed = await AsyncStorage.getItem(DEVICE_CLIENT_ID_KEY);
//   if (existed) {
//     _deviceClientIdCache = existed;
//     return existed;
//   }

//   const created = genClientId();
//   await AsyncStorage.setItem(DEVICE_CLIENT_ID_KEY, created);
//   _deviceClientIdCache = created;
//   return created;
// }

// async function reportBankOnServer(args: {
//   bankName: string;
//   accountNorm: string;
//   note?: string | null;
// }) {
//   const client_id = await getDeviceClientId();

//   const input = {
//     bank_name: String(args.bankName || "").trim() || "UNKNOWN",
//     account: args.accountNorm,
//     note: args.note ?? null,
//     client_id,
//     device_model: Platform.OS,
//     os_version: String(Platform.Version),
//     app_version: "1.0.0",
//   };

//   const { data } = await client.mutate({
//     mutation: M_REPORT_SCAM_BANK_ACCOUNT,
//     variables: { input },
//   });

//   return data?.reportScamBankAccount;
// }

// async function unreportBankOnServer(args: {
//   bankName: string;
//   accountNorm: string;
//   reason?: string | null;
// }) {
//   const client_id = await getDeviceClientId();

//   const input = {
//     bank_name: String(args.bankName || "").trim() || "UNKNOWN",
//     account: args.accountNorm,
//     client_id,
//     device_model: Platform.OS,
//     os_version: String(Platform.Version),
//     app_version: "1.0.0",
//     reason: args.reason ?? null,
//   };

//   const { data } = await client.mutate({
//     mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
//     variables: { input },
//   });

//   return data?.unreportScamBankAccount;
// }


export const HomeScreen: React.FC = () => {
  const { isLoggedIn, user } = useAuth();

  const [items, setItems] = useState<PostItem[]>([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [q] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [bookmarkBusyMap, setBookmarkBusyMap] = useState<Record<string, boolean>>(
    {}
  );

  // ✅ blocked tel (local) — map: tel -> entry
  const [blockedMap, setBlockedMap] = useState<StoredBlockedTelMap>({});

  // ✅ reported bank (local) — map: account -> entry
  const [reportedBankMap, setReportedBankMap] = useState<StoredReportedBankMap>({});

  // modal for viewing all tels of a post
  const [telModalVisible, setTelModalVisible] = useState(false);
  const [telModalTels, setTelModalTels] = useState<string[]>([]);
  const [telModalTitle, setTelModalTitle] = useState<string>("");
  const [telModalPostId, setTelModalPostId] = useState<string | undefined>(
    undefined
  );

  // modal for viewing all bank accounts of a post
  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [bankModalTitle, setBankModalTitle] = useState<string>("");
  const [bankModalPostId, setBankModalPostId] = useState<string | undefined>(
    undefined
  );
  const [bankModalList, setBankModalList] = useState<
    Array<{ bank_name?: string | null; seller_account?: string | null }>
  >([]);

  const canLoadMore = items.length < total;

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<HomeRoute>();

  // ✅ sheets refs
  const blockSheetRef = useRef<BottomSheetBlockReportModalRef>(null);
  const reportBankSheetRef = useRef<BottomSheetReportBankModalRef>(null);

  // ✅ guard: require login before opening any sheet
  const requireLoginOrGo = useCallback(
    (e?: any) => {
      e?.stopPropagation?.();
      if (isLoggedIn) return true;

      setTelModalVisible(false);
      setBankModalVisible(false);

      navigation.navigate("SignIn");
      return false;
    },
    [isLoggedIn, navigation]
  );

  const openUrl = useCallback(async (url?: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("เปิดลิงก์ไม่ได้", url);
    }
  }, []);

  // ====== load/save blocked tel ======
  const loadBlocked = useCallback(async () => {
    const next = await loadBlockedTelMap();
    setBlockedMap(next);
  }, []);

  const persistBlocked = useCallback((m: StoredBlockedTelMap) => {
    void saveBlockedTelMap(m);
  }, []);

  // ====== load/save reported bank ======
  const loadReportedBank = useCallback(async () => {
    const next = await loadReportedBankMap();
    setReportedBankMap(next);
  }, []);

  const persistReportedBank = useCallback((m: StoredReportedBankMap) => {
    void saveReportedBankMap(m);
  }, []);

  const isTelBlocked = useCallback(
    (tel: string) => {
      const n = normalizeTel(tel);
      return !!(n && blockedMap[n]);
    },
    [blockedMap]
  );

  const isBankReported = useCallback(
    (acc: string) => {
      const n = normalizeBankAccount(acc);
      return !!(n && reportedBankMap[n]);
    },
    [reportedBankMap]
  );


  const openBlockSheet = useCallback(
    (
      e: any,
      telRaw: string,
      meta?: { postId?: string; title?: string; source?: "HOME" | "MODAL" }
    ) => {
      if (!requireLoginOrGo(e)) return;

      const tel = normalizeTel(telRaw);
      if (!tel) return;

      const entry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      blockSheetRef.current?.open({
        tel,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
        initialWantReport: entry?.wantReport,
        initialCategory: entry?.category,
        initialNote: entry?.note,
      });
    },
    [requireLoginOrGo, blockedMap]
  );

  const openReportBankSheet = useCallback(
    (
      e: any,
      bankName: string | null | undefined,
      accountRaw: string,
      meta?: { postId?: string; title?: string; source?: "HOME" | "MODAL" }
    ) => {
      if (!requireLoginOrGo(e)) return;

      const acc = normalizeBankAccount(accountRaw);
      if (!acc) return;

      const entry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;

      reportBankSheetRef.current?.open({
        bankName: bankName ?? null,
        account: acc,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
        initialCategory: entry?.category,
        initialNote: entry?.note,
      });
    },
    [requireLoginOrGo, reportedBankMap]
  );

  const fetchPage = useCallback(
    async (targetPage: number, mode: "replace" | "append") => {
      const targetOffset = (targetPage - 1) * PAGE_SIZE;

      const result = await client.query<PostsPagedResponse, PostsPagedVars>({
        query: Q_POSTS_PAGED,
        variables: { q, limit: PAGE_SIZE, offset: targetOffset },
        fetchPolicy: "network-only",
      });

      const next = result.data?.postsPaged?.items ?? [];
      const nextTotal = result.data?.postsPaged?.total ?? 0;

      setTotal(nextTotal);

      if (mode === "replace") {
        setItems(next);
        setPage(targetPage);
      } else {
        setItems((prev) => {
          const map = new Map<string, PostItem>();
          for (const p of prev) map.set(p.id, p);
          for (const p of next) map.set(p.id, p);
          return Array.from(map.values());
        });
        setPage(targetPage);
      }
    },
    [q]
  );

  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      await fetchPage(1, "replace");
      await loadBlocked();
      await loadReportedBank();
    } catch (e: any) {
      Alert.alert("Load error", e?.message || "unknown");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loadBlocked, loadReportedBank]);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
    }, [loadFirst])
  );

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  // ✅ รับผล bookmark ที่ยิงมาจาก PostView (merge params)
  useEffect(() => {
    const p: any = route.params as any;
    if (!p?.bookmarkPing || !p?.bookmarkPostId) return;

    const postId = String(p.bookmarkPostId);
    const val = !!p.bookmarkValue;

    setItems((prev) =>
      prev.map((x) => (x.id === postId ? { ...x, is_bookmarked: val } : x))
    );

    // clear ping (กันยิงซ้ำ)
    navigation.setParams({
      bookmarkPing: undefined,
      bookmarkPostId: undefined,
      bookmarkValue: undefined,
    } as any);
  }, [route.params, navigation]);

  const onRefresh = useCallback(async () => {
    await loadFirst();
  }, [loadFirst]);

  const onLoadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    if (!canLoadMore) return;
    setLoadingMore(true);
    try {
      await fetchPage(page + 1, "append");
    } catch (e: any) {
      Alert.alert("Load more error", e?.message || "unknown");
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, canLoadMore, fetchPage, page]);

  const handleShare = useCallback(async (r: PostItem) => {
    const payload = buildSharePayload(r);
    try {
      await Share.share(
        {
          title: payload.title,
          message:
            Platform.OS === "ios"
              ? payload.text
              : `${payload.text}\n\n${payload.url}`,
          url: payload.url,
        },
        { dialogTitle: "Share post" }
      );
    } catch {}
  }, []);

  const onOpenProfile = useCallback(
    (e: GestureResponderEvent, authorId?: string | null) => {
      e.stopPropagation?.();
      if (!authorId) return;
      navigation.navigate("Profile", { id: authorId });
    },
    [navigation]
  );

  const applyBookmarkToList = useCallback(
    (postId: string, isBookmarked: boolean) => {
      setItems((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, is_bookmarked: isBookmarked } : p
        )
      );
    },
    []
  );

  const toggleBookmark = useCallback(
    async (e: GestureResponderEvent, postId: string) => {
      e.stopPropagation?.();

      if (!isLoggedIn) {
        navigation.navigate("SignIn");
        return;
      }

      if (bookmarkBusyMap[postId]) return;

      const prevItem = items.find((x) => x.id === postId);
      const prevVal = !!prevItem?.is_bookmarked;

      setBookmarkBusyMap((m) => ({ ...m, [postId]: true }));
      applyBookmarkToList(postId, !prevVal);

      try {
        const { data } = await client.mutate<{
          toggleBookmark?: { status?: string | null; isBookmarked?: boolean | null } | null;
        }>({
          mutation: M_TOGGLE_BOOKMARK,
          variables: { postId },
        });

        const ok = !!data?.toggleBookmark?.isBookmarked;
        applyBookmarkToList(postId, ok);
      } catch (err: any) {
        applyBookmarkToList(postId, prevVal);
        Alert.alert(
          "Bookmark error",
          err?.message || "Please login first or try again."
        );
      } finally {
        setBookmarkBusyMap((m) => ({ ...m, [postId]: false }));
      }
    },
    [isLoggedIn, navigation, bookmarkBusyMap, items, applyBookmarkToList]
  );

  const openChatWithAuthor = useCallback(
    (e: GestureResponderEvent, authorId?: string | null) => {
      e.stopPropagation?.();
      if (!authorId) return;

      if (!isLoggedIn) {
        navigation.navigate("SignIn");
        return;
      }

      if (authorId === user?.id) return;

      navigation.navigate("Chat", { to: String(authorId) } as any);
    },
    [isLoggedIn, navigation, user?.id]
  );

  const openAllTelsModal = useCallback(
    (title: string, tels: string[], postId?: string) => {
      setTelModalTitle(title || "เบอร์โทร");
      setTelModalTels(tels);
      setTelModalPostId(postId);
      setTelModalVisible(true);
    },
    []
  );

  const openAllBanksModal = useCallback(
    (
      title: string,
      list: Array<{ bank_name?: string | null; seller_account?: string | null }>,
      postId?: string
    ) => {
      setBankModalTitle(title || "บัญชีธนาคาร");
      setBankModalList(list || []);
      setBankModalPostId(postId);
      setBankModalVisible(true);
    },
    []
  );

  // ใช้เช็ค blocked
  const isBlocked = useCallback(
    (telNormalized: string) => {
      const n = normalizeTel(telNormalized);
      return !!(n && blockedMap[n]);
    },
    [blockedMap]
  );

  // ✅ REPORT TEL -> ยิง reportScamPhone
  const reportTel = useCallback(
    async (payload: { tel: string; category?: ReportCategory | null; note?: string | null; postId?: string }) => {
      const tel = normalizeTel(payload.tel);
      if (!tel) {
        Alert.alert("เบอร์ไม่ถูกต้อง", "กรุณาลองใหม่");
        return;
      }

      const clientId = await getDeviceClientId();

      const input = {
        phone: tel,
        note: payload.note?.trim() ? String(payload.note).trim() : null,
        local_blocked: isBlocked(tel),
        client_id: clientId,
        device_model: Platform.OS,
        os_version: String(Platform.Version),
        app_version: "1.0.0",
        category: payload.category ?? null,
      };

      try {
        const res = await client.mutate<{
          reportScamPhone:
            | {
                updated_at?: string | null;
                ctx?: unknown;
                tags?: string[] | null;
              }
            | null;
        }>({
          mutation: REPORT_SCAM_PHONE,
          variables: { input },
        });

        Alert.alert("ส่งรายงานแล้ว", "ขอบคุณที่ช่วยกันทำให้ระบบแม่นขึ้น 🙏");
        return res.data?.reportScamPhone;
      } catch (e: any) {
        console.log("REPORT TEL ERROR", e?.message || e);
        Alert.alert("รายงานไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
        throw e;
      }
    },
    [isBlocked]
  );

  async function unblockTelOnServer(phone: string) {
    const clientId = await getDeviceClientId();
    const input = {
      phone,
      client_id: clientId,
      device_model: Platform.OS,
      os_version: String(Platform.Version),
      app_version: "1.0.0",
    };

    const res = await client.mutate<{
      unblockScamPhone:
        | {
            updated_at?: string | null;
            ctx?: unknown;
            tags?: string[] | null;
          }
        | null;
    }>({
      mutation: UNBLOCK_SCAM_PHONE,
      variables: { input },
    });

    return res.data?.unblockScamPhone;
  }

  // ✅ Bank: report/unreport helpers
  async function reportBankOnServer(args: {
    bankName: string;
    accountNorm: string;
    note?: string | null;
  }) {
    const clientId = await getDeviceClientId();
    const input = {
      bank_name: String(args.bankName || "").trim() || "UNKNOWN",
      account: args.accountNorm,
      note: args.note ?? null,
      client_id: clientId,
      device_model: Platform.OS,
      os_version: String(Platform.Version),
      app_version: "1.0.0",
    };

    const { data } = await client.mutate<{
      reportScamBankAccount:
        | {
            bank_name?: string | null;
            updated_at?: string | null;
            ctx?: unknown;
            tags?: string[] | null;
          }
        | null;
    }>({
      mutation: M_REPORT_SCAM_BANK_ACCOUNT,
      variables: { input },
    });

    return data?.reportScamBankAccount;
  }

  async function unreportBankOnServer(args: {
    bankName: string;
    accountNorm: string;
    reason?: string | null;
  }) {
    const clientId = await getDeviceClientId();
    const input = {
      bank_name: String(args.bankName || "").trim() || "UNKNOWN",
      account: args.accountNorm,
      client_id: clientId,
      device_model: Platform.OS,
      os_version: String(Platform.Version),
      app_version: "1.0.0",
      reason: args.reason ?? null,
    };

    const { data } = await client.mutate<{
      unreportScamBankAccount:
        | {
            bank_name?: string | null;
            updated_at?: string | null;
            ctx?: unknown;
            tags?: string[] | null;
          }
        | null;
    }>({
      mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
      variables: { input },
    });

    return data?.unreportScamBankAccount;
  }

  const performTelConfirm = useCallback(
    async (value: { tel: string; wantReport: boolean; category: ReportCategory; note: string; postId?: string }) => {
      const tel = normalizeTel(value.tel);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      const optimisticEntry: StoredBlockedTelEntry = {
        wantReport: !!value.wantReport,
        category: value.wantReport ? value.category : undefined,
        note: value.wantReport ? value.note : "",
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev, [tel]: optimisticEntry };
        persistBlocked(next);
        return next;
      });

      try {
        const payload = await reportTel({
          tel,
          category: value.wantReport ? value.category : null,
          note: value.wantReport ? value.note : null,
          postId: value.postId,
        });

        if (payload) {
          setBlockedMap((prev) => {
            const next: StoredBlockedTelMap = {
              ...prev,
              [tel]: {
                ...optimisticEntry,
                blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistBlocked(next);
            return next;
          });
        }
      } catch {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev };
          if (prevEntry) next[tel] = prevEntry;
          else delete next[tel];
          persistBlocked(next);
          return next;
        });
      }
    },
    [blockedMap, persistBlocked, reportTel]
  );

  const performTelUndo = useCallback(
    async (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;
      if (!prevEntry) return;

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev };
        delete next[tel];
        persistBlocked(next);
        return next;
      });

      try {
        await unblockTelOnServer(tel);
        Alert.alert("ยกเลิกบล็อกแล้ว", tel);
      } catch (e: any) {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev, [tel]: prevEntry };
          persistBlocked(next);
          return next;
        });
        Alert.alert("Unblock ไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
      }
    },
    [blockedMap, persistBlocked]
  );

  const performBankConfirm = useCallback(
    async (value: {
      bankName: string | null;
      account: string;
      category: StoredReportedBankEntry["category"];
      note: string;
    }) => {
      const acc = normalizeBankAccount(value.account);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      const wasReported = !!prevEntry;

      const optimisticEntry: StoredReportedBankEntry = {
        bank_name: value.bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev, [acc]: optimisticEntry };
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(value.bankName || "").trim() || "UNKNOWN";
      const noteEncoded = encodeBankCategoryIntoText(value.category, value.note);

      try {
        const payload = await reportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          note: noteEncoded,
        });

        if (payload) {
          setReportedBankMap((prev) => {
            const next: StoredReportedBankMap = {
              ...prev,
              [acc]: {
                ...optimisticEntry,
                bank_name: payload.bank_name ?? optimisticEntry.bank_name,
                reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistReportedBank(next);
            return next;
          });
        }

        Alert.alert("สำเร็จ", wasReported ? "อัปเดตรายงานแล้ว" : "รายงานบัญชีเรียบร้อยแล้ว");
      } catch (err: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev };
          if (prevEntry) next[acc] = prevEntry;
          else delete next[acc];
          persistReportedBank(next);
          return next;
        });

        Alert.alert("ทำรายการไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank]
  );

  const performBankUndo = useCallback(
    async (bankName: string | null, accountRaw: string) => {
      const acc = normalizeBankAccount(accountRaw);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      if (!prevEntry) return;

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev };
        delete next[acc];
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(bankName || "").trim() || "UNKNOWN";
      const reasonEncoded = encodeBankCategoryIntoText(prevEntry.category, prevEntry.note ?? null);

      try {
        await unreportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          reason: reasonEncoded,
        });

        Alert.alert("สำเร็จ", "ยกเลิกรายงานบัญชีแล้ว");
      } catch (err: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev, [acc]: prevEntry };
          persistReportedBank(next);
          return next;
        });

        Alert.alert("ทำรายการไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank]
  );

  const renderPostItem = useCallback(
    ({ item }: { item: PostItem }) => {
      const ts = formatDateTime(item.created_at);
      const status = item.status || undefined;
      const sc = statusColor(status);
      const published = isFacebookPublished(item);

      const telListRaw = (item.tel_numbers || [])
        .map((t) => t.tel)
        .filter(Boolean);
      const telList = telListRaw
        .map((t) => normalizeTel(String(t)))
        .filter(Boolean);

      const bankRaw = (item.seller_accounts || []).filter(Boolean);
      const bankList = bankRaw
        .map((a) => ({
          bank_name: a.bank_name ?? null,
          seller_account: a.seller_account ?? null,
        }))
        .filter((x) => !!normalizeBankAccount(x.seller_account || ""));

      const onOpenPost = () => {
        navigation.navigate("PostView", {
          id: String(item?.id),
          currentUserId: user?.id,
        } as any);
      };

      const authorName = item.author?.name?.trim() || "Unknown";
      const authorInitial = authorName?.[0]?.toUpperCase?.() || "?";
      const authorAvatar = item.author?.avatar
        ? String(item.author.avatar)
        : null;

      const isBookmarked = !!item.is_bookmarked;
      const bookmarkBusy = !!bookmarkBusyMap[item.id];

      const showChatBtn =
        !!item.author?.id &&
        !!user?.id &&
        String(item.author.id) !== String(user.id);

      const INLINE_MAX_TELS = 3;
      const inlineTels = telList.slice(0, INLINE_MAX_TELS);
      const moreCount = Math.max(0, telList.length - INLINE_MAX_TELS);

      const INLINE_MAX_BANKS = 2;
      const inlineBanks = bankList.slice(0, INLINE_MAX_BANKS);
      const moreBanksCount = Math.max(0, bankList.length - INLINE_MAX_BANKS);

      return (
        <Pressable
          onPress={onOpenPost}
          android_ripple={{ color: "#222" }}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
        >
          {/* TOP */}
          <View style={styles.cardTop}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title || "-"}
            </Text>

            {status ? (
              <View style={[styles.tag, { backgroundColor: sc.bg }]}>
                <Text style={[styles.tagText, { color: sc.fg }]}>
                  {String(status).toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>

          {/* META + AUTHOR */}
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {ts}
            </Text>

            {item.author?.id ? (
              <Pressable
                onPress={(e) => onOpenProfile(e, item.author?.id)}
                style={({ pressed }) => [
                  styles.authorChip,
                  pressed && { opacity: 0.8 },
                ]}
                hitSlop={10}
              >
                {authorAvatar ? (
                  <Image
                    source={{ uri: authorAvatar }}
                    style={styles.authorAvatar}
                  />
                ) : (
                  <View style={styles.authorAvatarFallback}>
                    <Text style={styles.authorAvatarText}>
                      {authorInitial}
                    </Text>
                  </View>
                )}
                <Text style={styles.authorName} numberOfLines={1}>
                  {authorName}
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#9ca3af" />
              </Pressable>
            ) : (
              <Text style={[styles.meta, { marginLeft: 8 }]} numberOfLines={1}>
                • by {authorName}
              </Text>
            )}
          </View>

          {/* THUMB GRID */}
          <View style={{ marginTop: 10 }}>
            <ThumbGrid
              images={(item.images || []) as any}
              width={Dimensions.get("window").width - 24 - 20}
              height={160}
              radius={14}
              gap={6}
            />
          </View>

          {/* DETAIL */}
          {item.detail ? (
            <Text style={styles.detail} numberOfLines={4}>
              {item.detail}
            </Text>
          ) : null}

          {/* TEL chips */}
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Tel:</Text>

            {telList.length === 0 ? (
              <Text style={styles.infoValue} numberOfLines={1}>
                -
              </Text>
            ) : (
              <View style={styles.chipsWrap}>
                {inlineTels.map((tel) => {
                  const blocked = isTelBlocked(tel);
                  return (
                    <TouchableOpacity
                      key={tel}
                      onPress={(e: any) =>
                        openBlockSheet(e, tel, {
                          postId: item.id,
                          title: item.title ?? undefined,
                          source: "HOME",
                        })
                      }
                      activeOpacity={0.85}
                      style={[styles.telChip, blocked && styles.telChipBlocked]}
                    >
                      <Text style={styles.chipMainText} numberOfLines={1}>
                        {tel}
                      </Text>
                      <View style={styles.chipRight}>
                        <Ionicons
                          name={blocked ? "lock-closed" : "lock-open-outline"}
                          size={12}
                          color={blocked ? "#fff" : "#e5e7eb"}
                        />
                        <Text style={styles.chipRightText}>
                          {blocked ? "บล็อกแล้ว" : "บล็อก"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {moreCount > 0 ? (
                  <TouchableOpacity
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      openAllTelsModal(
                        item.title || "เบอร์โทรทั้งหมด",
                        telList,
                        item.id
                      );
                    }}
                    style={styles.moreChip}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.moreChipText}>+{moreCount}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {/* BANK chips (REPORT/UNREPORT) */}
          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Bank:</Text>

            {bankList.length === 0 ? (
              <Text style={styles.infoValue} numberOfLines={1}>
                -
              </Text>
            ) : (
              <View style={styles.chipsWrap}>
                {inlineBanks.map((b, idx) => {
                  const acc = normalizeBankAccount(b.seller_account || "");
                  const reported = isBankReported(acc);
                  const label = `${b.bank_name || "Bank"}: ${acc}`;

                  return (
                    <TouchableOpacity
                      key={`${acc}-${idx}`}
                      onPress={(e: any) =>
                        openReportBankSheet(e, b.bank_name, acc, {
                          postId: item.id,
                          title: item.title ?? undefined,
                          source: "HOME",
                        })
                      }
                      activeOpacity={0.85}
                      style={[
                        styles.bankChip,
                        reported && styles.bankChipReported,
                      ]}
                    >
                      <Text style={styles.chipMainText} numberOfLines={1}>
                        {label}
                      </Text>

                      <View style={styles.chipRight}>
                        <Ionicons
                          name={reported ? "close-circle" : "megaphone-outline"}
                          size={12}
                          color={reported ? "#ef4444" : "#e5e7eb"}
                        />
                        <Text style={[styles.chipRightText, reported && { color: "#ef4444" }]}>
                          {reported ? "ยกเลิกรายงาน" : "รายงาน"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {moreBanksCount > 0 ? (
                  <TouchableOpacity
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      openAllBanksModal(
                        item.title || "บัญชีธนาคารทั้งหมด",
                        bankList,
                        item.id
                      );
                    }}
                    style={styles.moreChip}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.moreChipText}>+{moreBanksCount}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {/* ACTIONS */}
          <View style={styles.actionsRow}>
            <IconButton
              icon="logo-facebook"
              disabled={!published}
              onPress={() => openUrl(item.fb_permalink_url)}
            />
            <IconButton
              icon="chatbox-outline"
              badge={item.comments_count || 0}
              onPress={onOpenPost}
            />
            <IconButton
              icon="share-social-outline"
              onPress={() => handleShare(item)}
            />

            {showChatBtn ? (
              <IconButton
                icon="chatbubbles-outline"
                onPress={(e) => openChatWithAuthor(e as any, item.author?.id)}
              />
            ) : null}

            <View style={{ flex: 1 }} />

            {showChatBtn ? (
              <IconButton
                icon={isBookmarked ? "bookmark" : "bookmark-outline"}
                onPress={(e) => toggleBookmark(e as any, item.id)}
                disabled={bookmarkBusy}
                active={isBookmarked}
                loading={bookmarkBusy}
              />
            ) : null}
          </View>
        </Pressable>
      );
    },
    [
      navigation,
      user?.id,
      bookmarkBusyMap,
      isTelBlocked,
      isBankReported,
      openUrl,
      handleShare,
      openChatWithAuthor,
      toggleBookmark,
      openBlockSheet,
      openReportBankSheet,
      openAllTelsModal,
      openAllBanksModal,
    ]
  );

  const footer = useMemo(() => {
    if (!canLoadMore) return <View style={{ height: 24 }} />;
    return (
      <View style={styles.footer}>
        {loadingMore ? <ActivityIndicator /> : null}
        <Text style={styles.footerText}>
          {loadingMore ? "กำลังโหลดเพิ่ม..." : ""}
        </Text>
      </View>
    );
  }, [canLoadMore, loadingMore]);
  

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderPostItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && page === 1}
            onRefresh={onRefresh}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={onLoadMore}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="alert-circle-outline" size={22} color="#6b7280" />
              <Text style={styles.emptyText}>ยังไม่มีข้อมูล</Text>
            </View>
          ) : null
        }
        ListFooterComponent={footer}
      />

      {/* ===== MODAL: show all tels ===== */}
      <Modal
        visible={telModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTelModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTelModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {telModalTitle || "เบอร์โทร"}
              </Text>
              <TouchableOpacity
                onPress={() => setTelModalVisible(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={18} color="#e5e7eb" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalList}>
              {telModalTels.map((tel) => {
                const blocked = isTelBlocked(tel);
                return (
                  <View key={tel} style={styles.modalRow}>
                    <Text style={styles.modalTel} numberOfLines={1}>
                      {tel}
                    </Text>

                    <TouchableOpacity
                      onPress={(e: any) =>
                        openBlockSheet(e, tel, {
                          postId: telModalPostId,
                          title: telModalTitle,
                          source: "MODAL",
                        })
                      }
                      style={[
                        styles.modalBtn,
                        blocked && styles.modalBtnBlocked,
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={blocked ? "lock-closed" : "lock-open-outline"}
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.modalBtnText}>
                        {blocked ? "บล็อกแล้ว" : "บล็อก"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== MODAL: show all banks ===== */}
      <Modal
        visible={bankModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBankModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setBankModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {bankModalTitle || "บัญชีธนาคาร"}
              </Text>
              <TouchableOpacity
                onPress={() => setBankModalVisible(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={18} color="#e5e7eb" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalList}>
              {bankModalList.map((b, idx) => {
                const acc = normalizeBankAccount(b.seller_account || "");
                const reported = isBankReported(acc);
                const label = `${b.bank_name || "Bank"}: ${acc}`;

                return (
                  <View key={`${acc}-${idx}`} style={styles.modalRow}>
                    <Text style={styles.modalTel} numberOfLines={1}>
                      {label}
                    </Text>

                    <TouchableOpacity
                      onPress={(e: any) =>
                        openReportBankSheet(e, b.bank_name, acc, {
                          postId: bankModalPostId,
                          title: bankModalTitle,
                          source: "MODAL",
                        })
                      }
                      style={[
                        styles.modalBtn,
                        reported && styles.modalBtnReported,
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={reported ? "close-circle" : "megaphone-outline"}
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.modalBtnText}>
                        {reported ? "ยกเลิกรายงาน" : "รายงาน"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Bottom Sheet: Tel Block/Report ===== */}
      <BottomSheetBlockReportModal
        ref={blockSheetRef}
        isBlocked={(telNormalized) => !!blockedMap[normalizeTel(telNormalized)]}
        onConfirm={async ({ tel, wantReport, category, note, postId }) => {
          await performTelConfirm({ tel, wantReport, category, note, postId });
        }}
        onUndo={async ({ tel }) => {
          await performTelUndo(tel);
        }}
      />

      {/* ===== Bottom Sheet: Bank Report / Unreport ===== */}
     <BottomSheetReportBankModal
        ref={reportBankSheetRef}
        isReported={(accNormalized) => !!reportedBankMap[normalizeBankAccount(accNormalized)]}
        onConfirm={async ({ bankName, account, category, note }) => {
          await performBankConfirm({ bankName, account, category, note });
        }}
        onUndo={async ({ bankName, account }) => {
          await performBankUndo(bankName, account);
        }}
      />
    </View>
  );
};

function IconButton(props: {
  icon: string;
  onPress: (e?: any) => void;
  disabled?: boolean;
  badge?: number;
  active?: boolean;
  loading?: boolean;
}) {
  const { icon, onPress, disabled, badge, active, loading } = props;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.iconBtn,
        active && styles.iconBtnActive,
        disabled && { opacity: 0.35 },
      ]}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Ionicons name={icon as any} size={18} color="#e5e7eb" />
      )}

      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badge > 99 ? "99+" : String(badge)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },

  card: {
    backgroundColor: "#111116",
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "900" },

  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  tagText: { fontSize: 10, fontWeight: "900" },

  metaRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { color: "#9ca3af", fontSize: 11, flex: 1 },

  authorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    maxWidth: 180,
  },
  authorAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#111" },
  authorAvatarFallback: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  authorName: { color: "#e5e7eb", fontSize: 11, fontWeight: "800" },

  detail: { marginTop: 10, color: "#e5e7eb", fontSize: 12, lineHeight: 16 },

  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  infoLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "800", marginTop: 2 },
  infoValue: { flex: 1, color: "#fff", fontSize: 12 },

  chipsWrap: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },

  telChip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  telChipBlocked: { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.18)" },

  bankChip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  bankChipReported: { borderColor: "#34c759", backgroundColor: "rgba(52,199,89,0.14)" },

  chipMainText: { color: "#fff", fontSize: 12, fontWeight: "800", maxWidth: 220 },
  chipRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: "#2a2a35",
  },
  chipRightText: { color: "#e5e7eb", fontSize: 11, fontWeight: "900" },

  moreChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#15151c",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  moreChipText: { color: "#9ca3af", fontSize: 12, fontWeight: "900" },

  actionsRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: { borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.18)" },

  badge: {
    position: "absolute",
    right: -6,
    top: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#34c759",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: "#0b0b0f",
  },
  badgeText: { color: "#111", fontSize: 10, fontWeight: "900" },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 8 },
  emptyText: { color: "#6b7280", fontSize: 14 },

  footer: { paddingVertical: 16, alignItems: "center", gap: 8 },
  footerText: { color: "#9ca3af", fontSize: 12 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" },
  modalCard: { backgroundColor: "#111116", borderRadius: 16, borderWidth: 1, borderColor: "#2a2a35", padding: 12 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f26",
  },
  modalTitle: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "900" },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  modalList: { paddingTop: 10, gap: 10 },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTel: { flex: 1, color: "#e5e7eb", fontSize: 13, fontWeight: "800" },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#374151",
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  modalBtnBlocked: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  modalBtnReported: { backgroundColor: "#34c759", borderColor: "#34c759" },
  modalBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});
```

## src/screens/PostViewScreen.tsx

```tsx
// src/screens/PostViewScreen.tsx
import React, { useMemo, useLayoutEffect, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  Pressable,
  Share,
  Alert,
  Linking,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import Clipboard from "@react-native-clipboard/clipboard";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import ImageViewing from "react-native-image-viewing";
import { gql } from "@apollo/client";

import type { RootStackParamList } from "../navigation/types";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import { CommentsSection } from "../components/comments/CommentsSection";
import { useAuth } from "../auth/AuthProvider";

import {
  BottomSheetBlockReportModal,
  BottomSheetBlockReportModalRef,
  type ReportCategory,
} from "../components/BottomSheetBlockReportModal";

import {
  BottomSheetReportBankModal,
  BottomSheetReportBankModalRef,
  type BankCategory,
} from "../components/BottomSheetReportBankModal";

import {
  encodeBankCategoryIntoText,
  getDeviceClientId,
  loadBlockedTelMap,
  loadReportedBankMap,
  normalizeBankAccount,
  normalizeTel,
  saveBlockedTelMap,
  saveReportedBankMap,
  type StoredBlockedTelEntry,
  type StoredBlockedTelMap,
  type StoredReportedBankEntry,
  type StoredReportedBankMap,
} from "../lib/jachoeiLocalState";

/* =======================
 * GraphQL
 * ======================= */

const Q_POST = gql`
  query ($id: ID!) {
    post(id: $id) {
      detail
      transfer_amount
      transfer_date
      updated_at
      website
      is_bookmarked
      tel_numbers {
        id
        tel
      }
      status
      seller_accounts {
        bank_id
        bank_name
        id
        seller_account
      }
      province_name
      province_id
      title
      images {
        id
        url
      }
      id_card
      id
      first_last_name
      created_at
      author {
        avatar
        created_at
        email
        id
        name
        phone
        role
      }
      fb_permalink_url
      fb_published_at
      fb_status
      fb_social_post_id
    }
  }
`;

const M_TOGGLE_BOOKMARK = gql`
  mutation ToggleBookmark($postId: ID!) {
    toggleBookmark(postId: $postId) {
      status
      isBookmarked
    }
  }
`;

const DELETE_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

// --- New GraphQL mutations for report/unreport ---
const M_REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input){
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const M_UNREPORT_SCAM_BANK_ACCOUNT = gql`
  mutation UnreportScamBankAccount($input: UnreportScamBankAccountInput!) {
    unreportScamBankAccount(input: $input){
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const REPORT_SCAM_PHONE = gql`
  mutation ReportScamPhone($input: ReportScamPhoneInput!) {
    reportScamPhone(input: $input){
      phone
      report_count
      last_report_at
      risk_level
      tags
      updated_at
      is_deleted
      post_ids
      ctx
    }
  }
`;

const UNBLOCK_SCAM_PHONE = gql`
  mutation UnblockScamPhone($input: UnblockScamPhoneInput!) {
    unblockScamPhone(input: $input){
      phone
      report_count
      last_report_at
      risk_level
      tags
      updated_at
      is_deleted
      post_ids
      ctx
    }
  }
`;

/* =======================
 * Types
 * ======================= */

export type PostRecord = {
  id: string;
  title?: string;
  detail?: string;
  created_at?: string;

  first_last_name?: string;
  id_card?: string;
  transfer_amount?: number;
  transfer_date?: string;
  website?: string;
  province_name?: string;

  tel_numbers?: { id: string; tel: string }[];
  seller_accounts?: {
    id: string;
    bank_name?: string;
    seller_account?: string;
  }[];

  images?: { id: string; url: string }[];

  fb_status?: string;
  fb_permalink_url?: string;

  author?: { id: string; name?: string | null } | null;
  is_bookmarked?: boolean;
};

type Props = NativeStackScreenProps<RootStackParamList, "PostView">;

/* =======================
 * Local Storage (same as Home)
 * ======================= */
// (now uses shared helpers in src/lib/jachoeiLocalState.ts)

/* =======================
 * Screen
 * ======================= */

export const PostViewScreen: React.FC<Props> = ({ route, navigation }) => {
  const { id, currentUserId } = route.params;
  const { isLoggedIn, user } = useAuth();

  // ✅ require login guard
  const requireLoginOrGo = useCallback(() => {
    if (isLoggedIn) return true;
    navigation.navigate("SignIn");
    return false;
  }, [isLoggedIn, navigation]);

  const [post, setPost] = React.useState<PostRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // bookmark busy
  const [bookmarkBusy, setBookmarkBusy] = React.useState(false);

  // images preview
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);

  // ✅ blocked tel (local)
  const [blockedMap, setBlockedMap] = React.useState<StoredBlockedTelMap>({});
  // ✅ reported bank (local)
  const [reportedBankMap, setReportedBankMap] = React.useState<StoredReportedBankMap>({});

  // ✅ sheets refs
  const blockSheetRef = useRef<BottomSheetBlockReportModalRef>(null);
  const reportBankSheetRef = useRef<BottomSheetReportBankModalRef>(null);

  // --- Device info helpers ---
  const deviceModel = Platform.OS;
  const osVersion = String(Platform.Version);
  const appVersion = "unknown";

  const previewImages = React.useMemo(
    () =>
      (post?.images || []).map((img) => ({
        uri: `${ENV.apiBase}${img.url}`,
      })),
    [post?.images]
  );

  /* =======================
   * Load post by id
   * ======================= */
  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await client.query<{ post: PostRecord | null }>({
        query: Q_POST,
        variables: { id },
        fetchPolicy: "network-only",
      });

      const p = data?.post ?? null;
      setPost(p);
    } catch (e: any) {
      setError(e?.message || "โหลดข้อมูลโพสต์ไม่สำเร็จ");
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  /* =======================
   * ✅ Load local states (blocked/report)
   * ======================= */
  const loadBlocked = useCallback(async () => {
    const next = await loadBlockedTelMap();
    setBlockedMap(next);
  }, []);

  const persistBlocked = useCallback(async (m: StoredBlockedTelMap) => {
    await saveBlockedTelMap(m);
  }, []);

  const loadReportedBank = useCallback(async () => {
    const next = await loadReportedBankMap();
    setReportedBankMap(next);
  }, []);

  const persistReportedBank = useCallback(async (m: StoredReportedBankMap) => {
    await saveReportedBankMap(m);
  }, []);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  useEffect(() => {
    loadBlocked();
    loadReportedBank();
  }, [loadBlocked, loadReportedBank]);

  /* =======================
   * Helpers
   * ======================= */

  // --- Bank report/unreport ---
  const reportBankOnServer = useCallback(
    async (args: { bankName: string; accountNorm: string; note?: string | null }) => {
      const client_id = await getDeviceClientId();
      const input = {
        bank_name: String(args.bankName || "").trim() || "UNKNOWN",
        account: args.accountNorm,
        note: args.note ?? null,
        client_id,
        device_model: deviceModel,
        os_version: osVersion,
        app_version: appVersion,
      };
      const { data } = await client.mutate<{
        reportScamBankAccount:
          | {
              bank_name?: string | null;
              updated_at?: string | null;
              ctx?: unknown;
              tags?: string[] | null;
            }
          | null;
      }>({
        mutation: M_REPORT_SCAM_BANK_ACCOUNT,
        variables: { input },
      });
      return data?.reportScamBankAccount;
    },
    [deviceModel, osVersion, appVersion]
  );

  const unreportBankOnServer = useCallback(
    async (args: { bankName: string; accountNorm: string; reason?: string | null }) => {
      const client_id = await getDeviceClientId();
      const input = {
        bank_name: String(args.bankName || "").trim() || "UNKNOWN",
        account: args.accountNorm,
        client_id,
        device_model: deviceModel,
        os_version: osVersion,
        app_version: appVersion,
        reason: args.reason ?? null,
      };
      const { data } = await client.mutate<{
        unreportScamBankAccount:
          | {
              bank_name?: string | null;
              updated_at?: string | null;
              ctx?: unknown;
              tags?: string[] | null;
            }
          | null;
      }>({
        mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
        variables: { input },
      });
      return data?.unreportScamBankAccount;
    },
    [deviceModel, osVersion, appVersion]
  );

  // --- Tel report/unblock ---
  const reportTel = useCallback(
    async (args: { tel: string; note?: string | null; category?: string | null; postId?: string }) => {
      const phone = normalizeTel(args.tel);
      if (!phone) throw new Error("เบอร์ไม่ถูกต้อง");
      const client_id = await getDeviceClientId();
      const input = {
        phone,
        note: args.note ?? null,
        local_blocked: true,
        client_id,
        device_model: deviceModel,
        os_version: osVersion,
        app_version: appVersion,
        category: args.category ?? null,
      };
      const { data } = await client.mutate<{
        reportScamPhone:
          | {
              updated_at?: string | null;
              ctx?: unknown;
              tags?: string[] | null;
            }
          | null;
      }>({
        mutation: REPORT_SCAM_PHONE,
        variables: { input },
      });
      return data?.reportScamPhone;
    },
    [deviceModel, osVersion, appVersion]
  );

  const unblockTelOnServer = useCallback(
    async (tel: string) => {
      const phone = normalizeTel(tel);
      if (!phone) throw new Error("เบอร์ไม่ถูกต้อง");
      const client_id = await getDeviceClientId();
      const input = {
        phone,
        client_id,
        device_model: deviceModel,
        os_version: osVersion,
        app_version: appVersion,
      };
      const { data } = await client.mutate<{
        unblockScamPhone:
          | {
              updated_at?: string | null;
              ctx?: unknown;
              tags?: string[] | null;
            }
          | null;
      }>({
        mutation: UNBLOCK_SCAM_PHONE,
        variables: { input },
      });

      return data?.unblockScamPhone;
    },
    [deviceModel, osVersion, appVersion]
  );

  const performTelConfirm = useCallback(
    async (value: {
      tel: string;
      wantReport: boolean;
      category: ReportCategory;
      note: string;
      postId?: string;
    }) => {
      if (!requireLoginOrGo()) return;

      const tel = normalizeTel(value.tel);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      const optimisticEntry: StoredBlockedTelEntry = {
        wantReport: !!value.wantReport,
        category: value.wantReport ? value.category : undefined,
        note: value.wantReport ? value.note : "",
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev, [tel]: optimisticEntry };
        persistBlocked(next);
        return next;
      });

      try {
        const payload = await reportTel({
          tel,
          category: value.wantReport ? value.category : null,
          note: value.wantReport ? value.note : null,
          postId: value.postId,
        });

        if (payload) {
          setBlockedMap((prev) => {
            const next: StoredBlockedTelMap = {
              ...prev,
              [tel]: {
                ...optimisticEntry,
                blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistBlocked(next);
            return next;
          });
        }

        Alert.alert("สำเร็จ", prevEntry ? "อัปเดตรายงานแล้ว" : "บล็อกเบอร์แล้ว");
      } catch (e: any) {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev };
          if (prevEntry) next[tel] = prevEntry;
          else delete next[tel];
          persistBlocked(next);
          return next;
        });
        Alert.alert("ทำรายการไม่สำเร็จ", e?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [blockedMap, persistBlocked, reportTel, requireLoginOrGo]
  );

  const performTelUndo = useCallback(
    async (telRaw: string) => {
      if (!requireLoginOrGo()) return;

      const tel = normalizeTel(telRaw);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;
      if (!prevEntry) return;

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev };
        delete next[tel];
        persistBlocked(next);
        return next;
      });

      try {
        await unblockTelOnServer(tel);
        Alert.alert("ยกเลิกบล็อกแล้ว", tel);
      } catch (e: any) {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev, [tel]: prevEntry };
          persistBlocked(next);
          return next;
        });
        Alert.alert("Unblock ไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
      }
    },
    [blockedMap, persistBlocked, unblockTelOnServer, requireLoginOrGo]
  );

  const performBankConfirm = useCallback(
    async (value: {
      bankName: string | null;
      account: string;
      category: StoredReportedBankEntry["category"];
      note: string;
    }) => {
      if (!requireLoginOrGo()) return;

      const acc = normalizeBankAccount(value.account);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      const wasReported = !!prevEntry;

      const optimisticEntry: StoredReportedBankEntry = {
        bank_name: value.bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev, [acc]: optimisticEntry };
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(value.bankName || "").trim() || "UNKNOWN";
      const noteEncoded = encodeBankCategoryIntoText(value.category, value.note);

      try {
        const payload = await reportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          note: noteEncoded,
        });

        if (payload) {
          setReportedBankMap((prev) => {
            const next: StoredReportedBankMap = {
              ...prev,
              [acc]: {
                ...optimisticEntry,
                bank_name: payload.bank_name ?? optimisticEntry.bank_name,
                reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistReportedBank(next);
            return next;
          });
        }

        Alert.alert("สำเร็จ", wasReported ? "อัปเดตรายงานแล้ว" : "รายงานบัญชีเรียบร้อยแล้ว");
      } catch (e: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev };
          if (prevEntry) next[acc] = prevEntry;
          else delete next[acc];
          persistReportedBank(next);
          return next;
        });
        Alert.alert("ทำรายการไม่สำเร็จ", e?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank, reportBankOnServer, requireLoginOrGo]
  );

  const performBankUndo = useCallback(
    async (bankName: string | null, accountRaw: string) => {
      if (!requireLoginOrGo()) return;

      const acc = normalizeBankAccount(accountRaw);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      if (!prevEntry) return;

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev };
        delete next[acc];
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(bankName || "").trim() || "UNKNOWN";
      const reasonEncoded = encodeBankCategoryIntoText(prevEntry.category, prevEntry.note ?? null);

      try {
        await unreportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          reason: reasonEncoded,
        });
        Alert.alert("สำเร็จ", "ยกเลิกรายงานบัญชีแล้ว");
      } catch (e: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev, [acc]: prevEntry };
          persistReportedBank(next);
          return next;
        });
        Alert.alert("ทำรายการไม่สำเร็จ", e?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank, unreportBankOnServer, requireLoginOrGo]
  );

  const isOwner = !!currentUserId && currentUserId === post?.author?.id;

  const isFbPublished =
    String(post?.fb_status || "").toUpperCase() === "PUBLISHED" &&
    !!post?.fb_permalink_url;

  const isBookmarked = !!post?.is_bookmarked;

  // ✅ เงื่อนไข chat เหมือน Home
  const showChatBtn = useMemo(() => {
    const authorId = post?.author?.id;
    return !!authorId && !!user?.id && String(authorId) !== String(user.id);
  }, [post?.author?.id, user?.id]);

  const sharePayload = useMemo(() => {
    const url = `https://jachoei.com/post/${id}`;
    const title = post?.title || "จ่าเฉย (JACHOEI)";
    const text = post?.detail
      ? `${title}\n\n${String(post.detail).slice(0, 180)}${
          String(post.detail).length > 180 ? "..." : ""
        }`
      : title;
    return { url, title, message: text };
  }, [post?.title, post?.detail, id]);

  const openUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        Alert.alert("เปิดลิงก์ไม่ได้", url);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      console.warn("openUrl error", e);
      Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถเปิดลิงก์ได้");
    }
  }, []);

  const onShare = useCallback(async () => {
    try {
      await Share.share(sharePayload);
    } catch (e) {
      console.warn("share error", e);
    }
  }, [sharePayload]);

  const copyText = useCallback((v?: string) => {
    if (!v) return;
    Clipboard.setString(String(v));
    Alert.alert("คัดลอกแล้ว");
  }, []);

  const isTelBlocked = useCallback(
    (telRaw: string) => {
      const n = normalizeTel(telRaw);
      return !!(n && blockedMap[n]);
    },
    [blockedMap]
  );

  const isBankReported = useCallback(
    (accRaw: string) => {
      const n = normalizeBankAccount(accRaw);
      return !!(n && reportedBankMap[n]);
    },
    [reportedBankMap]
  );

  // ✅ open tel bottom sheet
  const openBlockSheet = useCallback(
    (telRaw: string) => {
      if (!requireLoginOrGo()) return;

      const tel = normalizeTel(telRaw);
      if (!tel) return;

      const entry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      blockSheetRef.current?.open({
        tel,
        postId: String(post?.id || ""),
        title: post?.title || undefined,
        source: "DETAIL",
        initialWantReport: entry?.wantReport,
        initialCategory: entry?.category as ReportCategory | undefined,
        initialNote: entry?.note ?? "",
      });
    },
    [requireLoginOrGo, post?.id, post?.title, blockedMap]
  );

  // ✅ open bank bottom sheet
  const openReportBankSheet = useCallback(
    (bankName: string | null | undefined, accountRaw: string) => {
      if (!requireLoginOrGo()) return;

      const acc = normalizeBankAccount(accountRaw);
      if (!acc) return;

      const entry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;

      reportBankSheetRef.current?.open({
        bankName: bankName ?? null,
        account: acc,
        initialCategory: (entry?.category as BankCategory | undefined) ?? "SCAM",
        initialNote: entry?.note ?? "",
        postId: String(post?.id || ""),
        title: post?.title || undefined,
        source: "MODAL",
      });
    },
    [requireLoginOrGo, post?.id, post?.title, reportedBankMap]
  );

  // ✅ open chat (เหมือน Home)
  const openChatWithAuthor = useCallback(
    (authorId?: string | null) => {
      if (!authorId) return;
      if (!requireLoginOrGo()) return;
      if (String(authorId) === String(user?.id)) return;
      navigation.navigate("Chat", { to: String(authorId) } as any);
    },
    [navigation, requireLoginOrGo, user?.id]
  );

  /* =======================
   * ✅ Bookmark toggle
   * ======================= */
  const onToggleBookmark = useCallback(async () => {
    if (!post?.id) return;

    if (!isLoggedIn) {
      navigation.navigate("SignIn");
      return;
    }

    if (bookmarkBusy) return;

    const prevVal = !!post.is_bookmarked;

    // optimistic
    setBookmarkBusy(true);
    setPost((p) => (p ? { ...p, is_bookmarked: !prevVal } : p));

    try {
      const { data } = await client.mutate<{
        toggleBookmark?: { status?: string | null; isBookmarked?: boolean | null } | null;
      }>({
        mutation: M_TOGGLE_BOOKMARK,
        variables: { postId: String(post.id) },
      });

      const ok = !!data?.toggleBookmark?.isBookmarked;
      setPost((p) => (p ? { ...p, is_bookmarked: ok } : p));

      // ✅ ส่งผลกลับ Home (แก้ปัญหากลับไปแล้ว list ไม่อัปเดต)
      navigation.navigate({
        name: "Home" as any,
        params: {
          bookmarkPostId: String(post.id),
          bookmarkValue: ok,
          bookmarkPing: Date.now(),
        },
        merge: true,
      } as any);
    } catch (e: any) {
      // rollback
      setPost((p) => (p ? { ...p, is_bookmarked: prevVal } : p));
      Alert.alert("Bookmark error", e?.message || "Please login first or try again.");
    } finally {
      setBookmarkBusy(false);
    }
  }, [post?.id, post?.is_bookmarked, isLoggedIn, navigation, bookmarkBusy]);

  /* =======================
   * Delete
   * ======================= */

  const handleDelete = useCallback(async () => {
    Alert.alert("ลบโพสต์", "ต้องการลบโพสต์นี้ใช่ไหม?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบ",
        style: "destructive",
        onPress: async () => {
          try {
            const { data } = await client.mutate<{ deletePost?: boolean | null }>({
              mutation: DELETE_POST,
              variables: { id },
            });

            if (data?.deletePost) {
              Alert.alert("สำเร็จ", "ลบโพสต์เรียบร้อย");
              navigation.goBack();
            } else {
              Alert.alert("ไม่สำเร็จ", "ลบไม่สำเร็จ");
            }
          } catch (e: any) {
            Alert.alert("เกิดข้อผิดพลาด", e?.message || "Delete error");
          }
        },
      },
    ]);
  }, [id, navigation]);

  /* =======================
   * ✅ Navigation header
   * ======================= */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "",
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerRight: () => (
        <View style={styles.navActions}>
          {showChatBtn ? (
            <Pressable onPress={() => openChatWithAuthor(post?.author?.id)} hitSlop={10} style={styles.navBtn}>
              <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
            </Pressable>
          ) : null}

          {!isOwner ? (
            <Pressable
              onPress={onToggleBookmark}
              hitSlop={10}
              disabled={bookmarkBusy}
              style={({ pressed }) => [
                styles.navBtn,
                pressed && { opacity: 0.75 },
                bookmarkBusy && { opacity: 0.4 },
              ]}
            >
              {bookmarkBusy ? (
                <ActivityIndicator />
              ) : (
                <Ionicons
                  name={isBookmarked ? "bookmark" : "bookmark-outline"}
                  size={22}
                  color={isBookmarked ? "#60a5fa" : "#fff"}
                />
              )}
            </Pressable>
          ) : null}

          {isFbPublished ? (
            <Pressable
              onPress={() => {
                Alert.alert("Open Facebook", "ต้องการเปิดโพสต์บน Facebook ไหม?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Open", onPress: () => openUrl(post?.fb_permalink_url) },
                ]);
              }}
              hitSlop={10}
              style={styles.navBtn}
            >
              <Ionicons name="logo-facebook" size={22} color="#1877f2" />
            </Pressable>
          ) : null}

          <Pressable onPress={onShare} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </Pressable>

          {isOwner ? (
            <>
              <Pressable
                onPress={() => navigation.navigate("PostForm", { id: String(post?.id) } as any)}
                hitSlop={10}
                style={styles.navBtn}
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
              </Pressable>

              <Pressable onPress={handleDelete} hitSlop={10} style={styles.navBtn}>
                <Ionicons name="trash-outline" size={22} color="#ff3b30" />
              </Pressable>
            </>
          ) : null}
        </View>
      ),
    });
  }, [
    navigation,
    post?.id,
    post?.author?.id,
    post?.fb_permalink_url,
    isOwner,
    isFbPublished,
    isBookmarked,
    bookmarkBusy,
    showChatBtn,
    openChatWithAuthor,
    onToggleBookmark,
    onShare,
    openUrl,
    handleDelete,
  ]);

  /* =======================
   * Render list items
   * ======================= */

  const renderTelItem = useCallback(
    ({ item, index }: { item: { id: string; tel: string }; index: number }) => {
      const tel = item.tel || "";
      const blocked = isTelBlocked(tel);

      return (
        <View style={styles.rowItem}>
          <Text style={styles.rowIndex}>{index + 1}.</Text>

          <Pressable onPress={() => copyText(tel)} hitSlop={10} style={{ flex: 1 }}>
            <Text style={styles.rowText}>{tel || "-"}</Text>
            {tel ? <Text style={styles.copyHintSmall}>แตะเพื่อคัดลอก</Text> : null}
          </Pressable>

          <TouchableOpacity
            onPress={() => openBlockSheet(tel)}
            activeOpacity={0.85}
            style={[styles.actionPill, blocked && styles.actionPillDanger]}
          >
            <Ionicons name={blocked ? "lock-closed" : "lock-open-outline"} size={14} color="#fff" />
            <Text style={styles.actionPillText}>{blocked ? "บล็อกแล้ว" : "บล็อก"}</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [copyText, isTelBlocked, openBlockSheet]
  );

  const renderAccountItem = useCallback(
    ({
      item,
      index,
    }: {
      item: { id: string; bank_name?: string; seller_account?: string };
      index: number;
    }) => {
      const accRaw = item.seller_account || "";
      const acc = normalizeBankAccount(accRaw);
      const reported = isBankReported(acc);

      return (
        <View style={styles.rowItem}>
          <Text style={styles.rowIndex}>{index + 1}.</Text>

          <View style={{ flex: 1 }}>
            <Text style={styles.rowText}>{item.bank_name || "-"}</Text>
            <Pressable onPress={() => copyText(accRaw)}>
              <Text style={styles.copyText}>{accRaw || "-"}</Text>
            </Pressable>
          </View>

          <TouchableOpacity
            onPress={() => openReportBankSheet(item.bank_name, accRaw)}
            activeOpacity={0.85}
            style={[styles.actionPill, reported && styles.actionPillOk]}
          >
            <Ionicons name={reported ? "checkmark-circle" : "megaphone-outline"} size={14} color="#fff" />
            <Text style={styles.actionPillText}>{reported ? "รายงานแล้ว" : "รายงาน"}</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [copyText, isBankReported, openReportBankSheet]
  );

  /* =======================
   * UI: Loading / Error
   * ======================= */

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={[styles.emptyText, { marginTop: 10 }]}>กำลังโหลดข้อมูลโพสต์…</Text>
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || "ไม่พบโพสต์"}</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable style={styles.btnPrimary} onPress={fetchPost}>
            <Text style={styles.btnPrimaryText}>ลองใหม่</Text>
          </Pressable>

          <Pressable style={styles.btnGhost} onPress={() => navigation.goBack()}>
            <Text style={styles.btnGhostText}>กลับ</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* =======================
   * UI: Post view
   * ======================= */

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }}>
      <Text style={styles.bodyTitle} numberOfLines={3}>
        {post.title || "-"}
      </Text>

      {/* ===== BASIC INFO ===== */}
      <InfoRow label="รายละเอียด" value={post.detail} />
      <InfoRow label="ชื่อผู้ขาย" value={post.first_last_name} />
      <InfoRow label="เลขบัตร" value={post.id_card} copyable onCopy={copyText} />
      <InfoRow
        label="ยอดโอน"
        value={
          post.transfer_amount != null
            ? Number(post.transfer_amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
            : "-"
        }
      />
      <InfoRow label="วันที่โอน" value={post.transfer_date} />
      <InfoRow label="เว็บไซต์" value={post.website} copyable onCopy={copyText} />
      <InfoRow label="จังหวัด" value={post.province_name} />

      {/* ===== TEL NUMBERS ===== */}
      {!!post.tel_numbers?.length && (
        <>
          <SectionTitle title="เบอร์โทรศัพท์ / ไอดี" />
          <FlatList
            data={post.tel_numbers}
            keyExtractor={(i) => i.id}
            renderItem={renderTelItem}
            scrollEnabled={false}
          />
        </>
      )}

      {/* ===== SELLER ACCOUNTS ===== */}
      {!!post.seller_accounts?.length && (
        <>
          <SectionTitle title="บัญชีคนขาย" />
          <FlatList
            data={post.seller_accounts}
            keyExtractor={(i) => i.id}
            renderItem={renderAccountItem}
            scrollEnabled={false}
          />
        </>
      )}

      {/* ===== IMAGES ===== */}
      {!!post.images?.length && (
        <>
          <SectionTitle title="รูปภาพแนบ" />

          <View style={styles.imageGrid}>
            {post.images.map((img, index) => (
              <Pressable
                key={String(img.id)}
                style={styles.imageWrap}
                onPress={() => {
                  setPreviewIndex(index);
                  setPreviewVisible(true);
                }}
              >
                <Image source={{ uri: `${ENV.apiBase}${img.url}` }} style={styles.image} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.hint}>แตะรูปเพื่อดูแบบเต็มจอ</Text>

          <ImageViewing
            images={previewImages}
            imageIndex={previewIndex}
            visible={previewVisible}
            onRequestClose={() => setPreviewVisible(false)}
            swipeToCloseEnabled
            doubleTapToZoomEnabled
          />
        </>
      )}

      {/* ===== COMMENTS ===== */}
      <View style={[styles.commentsCol, { marginTop: 0 }]}>
        <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
          <Text style={styles.sectionTitle}>ความคิดเห็น</Text>
          <View style={styles.dividerLine} />
        </View>

        <CommentsSection postId={String(post.id)} currentUserId={currentUserId} />
      </View>

      {/* ===== Bottom Sheet: Tel Block/Report ===== */}
      <BottomSheetBlockReportModal
        ref={blockSheetRef}
        isBlocked={(telNormalized) => !!blockedMap[telNormalized]}
        onConfirm={async ({ tel, wantReport, category, note, postId }) => {
          await performTelConfirm({ tel, wantReport, category, note, postId });
        }}
        onUndo={async ({ tel }) => {
          await performTelUndo(tel);
        }}
      />

      {/* ===== Bottom Sheet: Bank Report ONLY ===== */}
      <BottomSheetReportBankModal
        ref={reportBankSheetRef}
        isReported={(accNormalized) => !!reportedBankMap[accNormalized]}
        onConfirm={async ({ bankName, account, category, note }) => {
          await performBankConfirm({ bankName, account, category, note });
        }}
        onUndo={async ({ bankName, account }) => {
          await performBankUndo(bankName, account);
        }}
      />
    </ScrollView>
  );
};

/* ====================== */
/* ===== COMPONENTS ===== */
/* ====================== */

const InfoRow = ({
  label,
  value,
  copyable,
  onCopy,
}: {
  label: string;
  value?: string | number;
  copyable?: boolean;
  onCopy?: (v?: string) => void;
}) => {
  const display = value != null && String(value).trim() !== "" ? String(value) : "-";

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoValue}>{display}</Text>
        {copyable && display !== "-" ? (
          <Pressable onPress={() => onCopy?.(display)} hitSlop={10}>
            <Text style={styles.copyHint}>แตะเพื่อคัดลอก</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const SectionTitle = ({ title }: { title: string }) => <Text style={styles.sectionTitle}>{title}</Text>;

/* ====================== */
/* ===== STYLES ===== */
/* ====================== */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    padding: 14,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0b0f",
    paddingHorizontal: 18,
  },
  emptyText: { color: "#6b7280", fontSize: 14 },
  errorText: { color: "#ff3b30", fontSize: 14, textAlign: "center" },

  btnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#2563eb",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2b2b2b",
  },
  btnGhostText: { color: "#e5e7eb", fontWeight: "800" },

  bodyTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#fff",
    lineHeight: 24,
    marginBottom: 12,
  },

  navActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 6,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },

  infoRow: { flexDirection: "row", marginBottom: 10 },
  infoLabel: { width: 120, color: "#9ca3af", fontSize: 13 },
  infoValue: { color: "#fff", fontSize: 14, lineHeight: 20 },
  copyHint: { fontSize: 11, color: "#60a5fa", marginTop: 2 },
  copyHintSmall: { fontSize: 11, color: "#60a5fa", marginTop: 2 },

  sectionTitle: {
    color: "#fff",
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 8,
    fontSize: 15,
  },

  rowItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
    gap: 10,
  },
  rowIndex: { width: 22, color: "#9ca3af", marginTop: 2 },
  rowText: { color: "#fff", fontSize: 14, lineHeight: 18 },

  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#374151",
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  actionPillDanger: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  actionPillOk: { backgroundColor: "#34c759", borderColor: "#34c759" },
  actionPillText: { color: "#fff", fontSize: 12, fontWeight: "900" },

  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  imageWrap: { borderRadius: 8, overflow: "hidden", backgroundColor: "#111" },
  image: { width: 110, height: 110, borderRadius: 8, backgroundColor: "#111" },
  hint: { marginTop: 8, color: "#6b7280", fontSize: 12 },

  copyText: { color: "#60a5fa", fontSize: 13, marginTop: 2 },

  commentsCol: {
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    padding: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#222",
    marginTop: 2,
  },
});
```

