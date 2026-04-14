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
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useI18n } from "../i18n";

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
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return hasPlus ? `+${digits}` : digits;
}

function computeRiskMeta(reportCount?: number, riskScore?: number) {
  const c = reportCount ?? 0;
  const s = typeof riskScore === "number" ? riskScore : -1;

  if (s >= 0) {
    if (s >= 80) return { key: "blocked_modal.risk_high", tone: "danger" as const };
    if (s >= 45) return { key: "blocked_modal.risk_medium", tone: "warn" as const };
    return { key: "blocked_modal.risk_low", tone: "muted" as const };
  }

  if (c >= 20) return { key: "blocked_modal.risk_high", tone: "danger" as const };
  if (c >= 5) return { key: "blocked_modal.risk_medium", tone: "warn" as const };
  return { key: "blocked_modal.risk_low", tone: "muted" as const };
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
  const { t } = useI18n();

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
    return computeRiskMeta(payload?.reportCount, payload?.riskScore);
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
    if (blockedNow) return t("blocked_modal.update_report");
    if (!wantReport) return t("blocked_modal.block_only");
    return t("blocked_modal.block_and_report");
  }, [blockedNow, wantReport, t]);

  const categoryOptions = useMemo(
    () => [
      {
        key: "SPAM" as const,
        label: t("blocked_modal.category_spam"),
        icon: "alert-circle-outline",
      },
      {
        key: "SCAM" as const,
        label: t("blocked_modal.category_scam"),
        icon: "warning-outline",
      },
      {
        key: "SALES" as const,
        label: t("blocked_modal.category_sales"),
        icon: "pricetag-outline",
      },
      {
        key: "HARASS" as const,
        label: t("blocked_modal.category_harass"),
        icon: "hand-left-outline",
      },
      {
        key: "OTHER" as const,
        label: t("blocked_modal.category_other"),
        icon: "ellipsis-horizontal",
      },
    ],
    [t]
  );

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

  const sheetMaxHeight = Math.round(screenH * 0.88);

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
        <Animated.View style={[styles.sheet, { maxHeight: sheetMaxHeight, transform: [{ translateY }] }]}> 
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerMain}>
              <View style={styles.titleRow}>
                <Text style={styles.hTitle}>
                  {blockedNow ? t("blocked_modal.manage_title") : t("blocked_modal.title")}
                </Text>

                <TouchableOpacity
                  onPress={close}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t("blocked_modal.close")}
                >
                  <Ionicons name="close" size={16} color="#cbd5e1" />
                </TouchableOpacity>
              </View>

              <View style={styles.telRow}>
                <View style={styles.phoneChip}>
                  <Ionicons name="call-outline" size={14} color="#9ca3af" />
                  <Text style={styles.telText} numberOfLines={1}>
                    {payload?.tel ?? "-"}
                  </Text>
                </View>

                <View style={[styles.riskPill, { backgroundColor: riskTone.bg }]}> 
                  <Text style={[styles.riskPillText, { color: riskTone.fg }]}> 
                    {t(risk.key)}
                  </Text>
                </View>
              </View>

              {payload?.title ? (
                <Text style={styles.subtle} numberOfLines={2}>
                  {t("blocked_modal.source_post", { title: payload.title })}
                </Text>
              ) : null}

              {typeof payload?.reportCount === "number" ? (
                <Text style={styles.reportCount}>
                  {t("blocked_modal.report_count", { count: payload.reportCount })}
                </Text>
              ) : null}
            </View>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t("blocked_modal.report_section_title")}</Text>

              <TouchableOpacity
                onPress={() => setWantReport((v) => !v)}
                style={styles.reportToggleCard}
                activeOpacity={0.9}
              >
                <View style={[styles.checkBox, wantReport && styles.checkBoxOn]}>
                  {wantReport ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
                </View>

                <View style={styles.sectionTextWrap}>
                  <Text style={styles.toggleTitle}>{t("blocked_modal.report_help_title")}</Text>
                  <Text style={styles.toggleDesc}>
                    {t("blocked_modal.report_help_subtitle")}
                  </Text>
                </View>
              </TouchableOpacity>

              {wantReport ? (
                <View style={styles.chipsWrap}>
                  {categoryOptions.map((item) => (
                    <Chip
                      key={item.key}
                      label={item.label}
                      icon={item.icon}
                      active={category === item.key}
                      onPress={() => setCategory(item.key)}
                    />
                  ))}
                </View>
              ) : null}
            </View>

            {wantReport ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel}>{t("blocked_modal.note_label")}</Text>
                  <Text style={styles.counter}>{note.length}/120</Text>
                </View>

                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("blocked_modal.note_placeholder")}
                  placeholderTextColor="#6b7280"
                  style={styles.input}
                  maxLength={120}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t("blocked_modal.preference_title")}</Text>

              <TouchableOpacity
                onPress={() => setDontAskAgain((v) => !v)}
                style={styles.preferenceRow}
                activeOpacity={0.9}
              >
                <View style={[styles.checkBox, dontAskAgain && styles.checkBoxOn]}>
                  {dontAskAgain ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
                </View>
                <Text style={styles.preferenceText}>{t("blocked_modal.dont_ask_again")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.hint}>{t("blocked_modal.footer_hint")}</Text>

            <View style={styles.footerActions}>
              <TouchableOpacity
                onPress={close}
                style={styles.footerCancel}
                disabled={busy}
              >
                <Text style={styles.footerCancelText}>{t("blocked_modal.cancel")}</Text>
              </TouchableOpacity>

              <View style={styles.footerMainActions}>
                {blockedNow ? (
                  <TouchableOpacity
                    onPress={onUnblock}
                    style={[styles.btn, styles.btnUnblock, busy && styles.btnDisabled]}
                    disabled={busy}
                  >
                    <View style={styles.btnRow}>
                      <Ionicons name="lock-open-outline" size={16} color="#e5e7eb" />
                      <Text style={styles.btnSecondaryText}>{t("blocked_modal.unblock")}</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={onPrimary}
                  style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
                  disabled={busy}
                >
                  <View style={styles.btnRow}>
                    <Ionicons name={blockedNow ? ("save" as any) : "lock-closed"} size={16} color="#111" />
                    <Text style={styles.btnPrimaryText}>
                      {busy ? t("blocked_modal.processing") : primaryText}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "#1f1f26",
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#32323d",
    marginBottom: 12,
  },

  header: {
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1b1b24",
  },
  headerMain: {
    gap: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  hTitle: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  telRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  phoneChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "#12121a",
    borderWidth: 1,
    borderColor: "#20202b",
  },
  telText: {
    flexShrink: 1,
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "900",
  },
  riskPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  riskPillText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  reportCount: {
    color: "#7c8597",
    fontSize: 12,
    lineHeight: 16,
  },
  subtle: {
    color: "#8c94a6",
    fontSize: 12,
    lineHeight: 17,
  },

  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#171720",
    borderWidth: 1,
    borderColor: "#272733",
    alignItems: "center",
    justifyContent: "center",
  },

  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 18,
  },
  section: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  reportToggleCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 18,
    backgroundColor: "#12121a",
    borderWidth: 1,
    borderColor: "#20202b",
  },
  sectionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  toggleTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "800",
  },
  toggleDesc: {
    color: "#8c94a6",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },

  preferenceRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1d1f28",
  },
  preferenceText: {
    flex: 1,
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },

  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#1a1a22",
    borderWidth: 1,
    borderColor: "#323241",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkBoxOn: { backgroundColor: "#34c759", borderColor: "#34c759" },

  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#171720",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  chipOn: { backgroundColor: "#34c759", borderColor: "#34c759" },
  chipText: { color: "#e5e7eb", fontSize: 12, fontWeight: "800" },

  input: {
    minHeight: 92,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#20202b",
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 19,
  },
  counter: {
    color: "#6b7280",
    fontSize: 11,
    textAlign: "right",
  },

  footer: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1b1b24",
    gap: 12,
  },
  footerActions: {
    gap: 12,
  },
  footerCancel: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  footerCancelText: {
    color: "#aab1c2",
    fontSize: 13,
    fontWeight: "700",
  },
  footerMainActions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  btnPrimary: { backgroundColor: "#34c759" },
  btnUnblock: {
    backgroundColor: "#16161d",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  btnDisabled: {
    opacity: 0.7,
  },

  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimaryText: { fontSize: 13, fontWeight: "900", color: "#111" },
  btnSecondaryText: { fontSize: 13, fontWeight: "800", color: "#e5e7eb" },

  hint: { color: "#6b7280", fontSize: 11, lineHeight: 15 },
});
