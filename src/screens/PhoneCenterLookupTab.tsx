// src/screens/PhoneCenterLookupTab.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  FlatList,
  Alert,
  Keyboard,
  Platform,
  Dimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { checkScamPhoneWithFallback } from "../lib/syncScamPhones";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../auth/AuthProvider";

// ======================================================
// GraphQL (PHONE)
// ======================================================
const SEARCH_SCAM_PHONES = gql`
  query SearchScamPhones($q: String!, $limit: Int!) {
    searchScamPhones(q: $q, limit: $limit) {
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

const REPORT_SCAM_PHONE = gql`
  mutation ReportScamPhone($input: ReportScamPhoneInput!) {
    reportScamPhone(input: $input) {
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

// ======================================================
// GraphQL (BANK)
// ======================================================
const SEARCH_SCAM_BANK_ACCOUNTS = gql`
  query SearchScamBankAccounts($q: String!, $limit: Int!) {
    searchScamBankAccounts(q: $q, limit: $limit) {
      account
      bank_name
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

const REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input) {
      account
      bank_name
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

// =======================
// Types
// =======================
type LookupType = "PHONE" | "BANK";

type ScamPhone = {
  __typename?: string;
  phone: string;
  report_count: number;
  last_report_at: string | null;
  risk_level: number;
  tags: string[];
  updated_at: string;
  is_deleted: boolean;
  post_ids: string[];
  ctx?: any;
};

type ScamBank = {
  __typename?: string;
  account: string;
  bank_name?: string | null;
  report_count: number;
  last_report_at: string | null;
  risk_level: number;
  tags: string[];
  updated_at: string;
  is_deleted: boolean;
  post_ids: string[];
  ctx?: any;
};

type CheckResult = {
  found: boolean;
  risk: number;
  reportCount: number;
};

export type ReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
export type BankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

// =======================
// Utils
// =======================
function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return hasPlus ? `+${digits}` : digits;
}

function normalizeBankAccount(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function fmtTime(v?: string | number | null) {
  if (v === null || v === undefined || v === "") return "-";
  const s = String(v);
  const onlyDigits = /^[0-9]+$/.test(s);
  try {
    if (onlyDigits) {
      const ms = Number(s);
      const msFixed = ms < 1e12 ? ms * 1000 : ms;
      return new Date(msFixed).toLocaleString();
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString();
  } catch {
    return s;
  }
}

function genClientId() {
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function riskText(risk: number) {
  if (risk >= 80) return "เสี่ยงสูงมาก";
  if (risk >= 60) return "เสี่ยงสูง";
  if (risk >= 40) return "เสี่ยงปานกลาง";
  if (risk >= 20) return "เสี่ยงต่ำ";
  return "ไม่ค่อยเสี่ยง";
}

function computeRiskLabel(reportCount?: number, riskScore?: number) {
  const c = reportCount ?? 0;
  const s = typeof riskScore === "number" ? riskScore : -1;

  if (s >= 0) {
    if (s >= 80) return { label: "HIGH", tone: "danger" as const };
    if (s >= 45) return { label: "MEDIUM", tone: "warn" as const };
    return { label: "LOW", tone: "muted" as const };
  }

  if (c >= 20) return { label: "HIGH", tone: "danger" as const };
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

// =======================
// Storage keys
// =======================
function blockedKey(userId: string) {
  return `jachoei.blockedPhones.v2.${userId || "guest"}`;
}

function historyKey(userId: string, type: LookupType) {
  return `jachoei.search_history.v2.${type}.${userId || "guest"}`;
}

const DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel
const HISTORY_MAX = 20;

function bankLocalReportedKey(userId: string, bankName: string | null | undefined, account: string) {
  const b = (bankName || "UNKNOWN").trim().toUpperCase();
  const a = normalizeBankAccount(account);
  return `jachoei.bank_reported_local.v1.${userId || "guest"}.${b}.${a}`;
}

async function loadBlockedMap(userId: string): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(blockedKey(userId));
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

async function persistBlockedMap(userId: string, map: Record<string, true>) {
  try {
    await AsyncStorage.setItem(blockedKey(userId), JSON.stringify(map));
  } catch {}
}

async function loadHistory(userId: string, type: LookupType): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(userId, type));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

async function persistHistory(userId: string, type: LookupType, list: string[]) {
  try {
    await AsyncStorage.setItem(historyKey(userId, type), JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {}
}

function addToHistory(list: string[], value: string) {
  const v = String(value || "").trim();
  if (!v) return list;
  const next = [v, ...list.filter((x) => x !== v)];
  return next.slice(0, HISTORY_MAX);
}

// =======================
// Header SearchBar (Nav Title)
// =======================
function HeaderSearchBar(props: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClearInput: () => void;
  loading?: boolean;

  historyOpen: boolean;
  onToggleHistory: () => void;

  placeholder?: string;
}) {
  const { value, onChangeText, onSubmit, onFocus, onBlur, onClearInput, loading, historyOpen, onToggleHistory, placeholder } =
    props;

  return (
    <View style={nav.headerOuter}>
      <View style={nav.headerPill}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" />

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder || "ค้นหา..."}
          placeholderTextColor="#6b7280"
          style={nav.input}
          returnKeyType="search"
          keyboardType="default"
          onSubmitEditing={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
        />

        {value?.length ? (
          <Pressable onPress={onClearInput} hitSlop={10} style={nav.iconBtn}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </Pressable>
        ) : (
          <View style={nav.iconBtn} />
        )}

        <Pressable onPress={onToggleHistory} hitSlop={10} style={[nav.iconBtn, historyOpen && nav.iconBtnActive]}>
          <Ionicons name="time-outline" size={18} color={historyOpen ? "#111" : "#cbd5e1"} />
        </Pressable>

        {loading ? (
          <View style={nav.miniLoader}>
            <ActivityIndicator />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// =======================
// History panel overlay
// =======================
function HistoryPanelOverlay(props: {
  visible: boolean;
  top: number;
  left: number;
  right: number;
  items: string[];
  onPick: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { visible, top, left, right, items, onPick, onClear, onClose } = props;
  if (!visible) return null;

  const maxH = Math.min(240, Math.round(Dimensions.get("window").height * 0.35));

  return (
    <View style={hp.root} pointerEvents="box-none">
      <Pressable style={hp.backdrop} onPress={onClose} />

      <View style={[hp.card, { top, left, right, maxHeight: maxH }]}>
        <View style={hp.cardHead}>
          <Text style={hp.headTitle}>ประวัติการค้นหา</Text>

          <Pressable onPress={onClear} hitSlop={10} style={hp.clearBtn}>
            <Text style={hp.clearText}>ล้าง</Text>
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Text style={hp.emptyText}>ยังไม่มีประวัติ</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => (
              <Pressable onPress={() => onPick(item)} style={[hp.row, index === 0 ? { borderTopWidth: 0 } : null]}>
                <Ionicons name="time-outline" size={18} color="#9ca3af" />
                <Text style={hp.rowText} numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}

// =======================
// Inline Phone Block/Report Panel
// =======================
function Chip(props: { label: string; icon: string; active?: boolean; onPress: () => void }) {
  const { label, icon, active, onPress } = props;
  return (
    <Pressable onPress={onPress} style={[ui.chip, active && ui.chipOn]}>
      <Ionicons name={icon as any} size={14} color={active ? "#111" : "#e5e7eb"} />
      <Text style={[ui.chipText, active && { color: "#111" }]}>{label}</Text>
    </Pressable>
  );
}

type InlinePanelProps = {
  tel: string;
  postId?: string;
  title?: string;
  reportCount?: number;
  riskScore?: number;

  // ✅ login guard
  isLoggedIn: boolean;
  goStack: (screen: string, params?: any) => void;

  isBlocked: (telNormalized: string) => boolean;
  onBlock: (telNormalized: string, meta?: { postId?: string }) => Promise<void> | void;
  onUnblock: (telNormalized: string, meta?: { postId?: string }) => Promise<void> | void;
  onReport: (data: { tel: string; category: ReportCategory; note?: string; postId?: string }) => Promise<void> | void;
};

function InlineBlockReportPanel(props: InlinePanelProps) {
  const { tel, postId, title, reportCount, riskScore, isLoggedIn, goStack, isBlocked, onBlock, onUnblock, onReport } = props;

  const telNorm = useMemo(() => normalizeTel(tel), [tel]);
  const blockedNow = useMemo(() => (telNorm ? isBlocked(telNorm) : false), [telNorm, isBlocked]);

  const risk = useMemo(() => computeRiskLabel(reportCount, riskScore), [reportCount, riskScore]);
  const riskTone = toneStyle(risk.tone);

  const [skipConfirmStored, setSkipConfirmStored] = useState(false);

  const [busy, setBusy] = useState(false);
  const [wantReport, setWantReport] = useState(true);
  const [category, setCategory] = useState<ReportCategory>("SCAM");
  const [note, setNote] = useState("");
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!telNorm) return;
      const skip = (await AsyncStorage.getItem(DONT_ASK_PREFIX + telNorm)) === "1";
      if (mounted) setSkipConfirmStored(skip);
    })();
    return () => {
      mounted = false;
    };
  }, [telNorm]);

  const primaryText = useMemo(() => {
    if (blockedNow) return "ยกเลิกบล็อก";
    if (!wantReport) return "บล็อก";
    return "บล็อก + รายงาน";
  }, [blockedNow, wantReport]);

  const onConfirm = useCallback(async () => {
    // ✅ Login guard (เพิ่มตามที่ขอ)
    if (!isLoggedIn) {
      goStack("SignIn");
      return;
    }

    if (!telNorm) return;
    setBusy(true);
    try {
      if (dontAskAgain) {
        await AsyncStorage.setItem(DONT_ASK_PREFIX + telNorm, "1");
        setSkipConfirmStored(true);
      }

      if (blockedNow) {
        await onUnblock(telNorm, { postId });
        return;
      }

      await onBlock(telNorm, { postId });

      if (wantReport) {
        await onReport({
          tel: telNorm,
          category,
          note: note.trim() ? note.trim() : undefined,
          postId,
        });
      }

      setNote("");
    } finally {
      setBusy(false);
    }
  }, [isLoggedIn, goStack, telNorm, blockedNow, onBlock, onUnblock, onReport, wantReport, category, note, dontAskAgain, postId]);

  const fallbackRiskScore = riskScore ?? clamp((reportCount ?? 0) * 10, 0, 100);

  return (
    <View style={ui.panel}>
      <View style={ui.panelHeader}>
        <View style={{ flex: 1 }}>
          <Text style={ui.hTitle}>{blockedNow ? "จัดการเบอร์ที่บล็อกไว้" : "Block / Report"}</Text>

          <View style={ui.telRow}>
            <Ionicons name="call-outline" size={16} color="#9ca3af" />
            <Text style={ui.telText}>{telNorm || "-"}</Text>

            <View style={[ui.riskPill, { backgroundColor: riskTone.bg }]}>
              <Text style={[ui.riskPillText, { color: riskTone.fg }]}>{risk.label}</Text>
            </View>

            {typeof reportCount === "number" ? <Text style={ui.reportCount}>• {reportCount} reports</Text> : null}
          </View>

          {title ? (
            <Text style={ui.subtle} numberOfLines={1}>
              จากโพสต์: {title}
            </Text>
          ) : null}
        </View>

        {skipConfirmStored ? (
          <View style={ui.fastBadge}>
            <Ionicons name="flash-outline" size={14} color="#111" />
            <Text style={ui.fastBadgeText}>FAST</Text>
          </View>
        ) : null}
      </View>

      {!blockedNow ? (
        <Pressable onPress={() => setWantReport((v) => !v)} style={ui.toggleRow}>
          <View style={[ui.checkBox, wantReport && ui.checkBoxOn]}>
            {wantReport ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.toggleTitle}>Report to help others</Text>
            <Text style={ui.toggleDesc} numberOfLines={2}>
              เลือกหมวด + ใส่โน้ตสั้น ๆ (ไม่บังคับ)
            </Text>
          </View>
        </Pressable>
      ) : null}

      {!blockedNow && wantReport ? (
        <>
          <View style={ui.chipsWrap}>
            <Chip label="Spam" icon="alert-circle-outline" active={category === "SPAM"} onPress={() => setCategory("SPAM")} />
            <Chip label="Scam" icon="warning-outline" active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
            <Chip label="Sales/Ads" icon="pricetag-outline" active={category === "SALES"} onPress={() => setCategory("SALES")} />
            <Chip label="Harass" icon="hand-left-outline" active={category === "HARASS"} onPress={() => setCategory("HARASS")} />
            <Chip label="Other" icon="ellipsis-horizontal" active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
          </View>

          <View style={{ marginTop: 10 }}>
            <Text style={ui.label}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="เช่น โทรขายของ / หลอกโอน / ทวงหนี้ / ก่อกวน..."
              placeholderTextColor="#6b7280"
              style={ui.input}
              maxLength={120}
              multiline
            />
            <Text style={ui.counter}>{note.length}/120</Text>
          </View>
        </>
      ) : null}

      <Pressable onPress={() => setDontAskAgain((v) => !v)} style={ui.toggleRow2}>
        <View style={[ui.checkBox, dontAskAgain && ui.checkBoxOn]}>
          {dontAskAgain ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
        </View>
        <Text style={ui.toggleTitle2}>ไม่ต้องถามอีกสำหรับเบอร์นี้</Text>
      </Pressable>

      <View style={ui.actions}>
        <Pressable
          onPress={onConfirm}
          style={[ui.btn, blockedNow ? ui.btnUnblock : ui.btnPrimary, busy && { opacity: 0.7 }]}
          disabled={busy}
        >
          <View style={ui.btnRow}>
            <Ionicons name={blockedNow ? "lock-open-outline" : "lock-closed"} size={16} color={blockedNow ? "#e5e7eb" : "#111"} />
            <Text style={[ui.btnPrimaryText, { color: blockedNow ? "#e5e7eb" : "#111" }]}>
              {busy ? "กำลังทำรายการ..." : primaryText}
            </Text>
          </View>
        </Pressable>
      </View>

      <Text style={ui.hint}>
        Risk tip: {fallbackRiskScore} • {riskText(fallbackRiskScore)}
      </Text>
    </View>
  );
}

// =======================
// Bank Report Inline Form
// =======================
function BankReportChip(props: { label: string; icon: string; active?: boolean; onPress: () => void }) {
  const { label, icon, active, onPress } = props;
  return (
    <Pressable onPress={onPress} style={[br.chip, active && br.chipOn]}>
      <Ionicons name={icon as any} size={16} color={active ? "#111" : "#e5e7eb"} />
      <Text style={[br.chipText, active && { color: "#111" }]}>{label}</Text>
    </Pressable>
  );
}

function BankReportInlineForm(props: {
  userId: string;
  account: string;
  bankName?: string | null;

  // ✅ login guard
  isLoggedIn: boolean;
  goStack: (screen: string, params?: any) => void;

  riskLabel: string;
  riskTone: { bg: string; fg: string };

  fromPostTitle?: string | null;

  onClose: () => void;
  onCancel: () => void;
  onSubmit: (payload: {
    account: string;
    bankName?: string | null;
    category: BankReportCategory;
    note?: string;
    rememberLocal: boolean;
  }) => Promise<void>;
}) {
  const { userId, account, bankName, isLoggedIn, goStack, riskLabel, riskTone, fromPostTitle, onClose, onCancel, onSubmit } =
    props;

  const accNorm = useMemo(() => normalizeBankAccount(account), [account]);

  const [category, setCategory] = useState<BankReportCategory>("SCAM");
  const [note, setNote] = useState("");
  const [rememberLocal, setRememberLocal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const k = bankLocalReportedKey(userId, bankName ?? null, accNorm);
        const v = (await AsyncStorage.getItem(k)) === "1";
        if (mounted) setRememberLocal(v);
      } catch {
        if (mounted) setRememberLocal(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId, bankName, accNorm]);

  const toggleRemember = useCallback(async () => {
    const next = !rememberLocal;
    setRememberLocal(next);
    try {
      const k = bankLocalReportedKey(userId, bankName ?? null, accNorm);
      await AsyncStorage.setItem(k, next ? "1" : "0");
    } catch {}
  }, [rememberLocal, userId, bankName, accNorm]);

  const submit = useCallback(async () => {
    // ✅ Login guard (เพิ่มตามที่ขอ)
    if (!isLoggedIn) {
      goStack("SignIn");
      return;
    }

    if (!accNorm) return;

    setBusy(true);
    try {
      await onSubmit({
        account: accNorm,
        bankName: bankName ?? null,
        category,
        note: note.trim() ? note.trim() : undefined,
        rememberLocal,
      });

      try {
        const k = bankLocalReportedKey(userId, bankName ?? null, accNorm);
        await AsyncStorage.setItem(k, rememberLocal ? "1" : "0");
      } catch {}

      setNote("");
    } catch (e: any) {
      Alert.alert("ส่งรายงานไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
      return;
    } finally {
      setBusy(false);
    }

    Alert.alert("ส่งรายงานแล้ว", "ขอบคุณที่ช่วยกันทำให้ระบบแม่นขึ้น 🙏");
  }, [isLoggedIn, goStack, accNorm, onSubmit, bankName, category, note, rememberLocal, userId]);

  return (
    <View style={br.sheet}>
      <View style={br.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={br.title}>รายงานบัญชีธนาคาร</Text>

          <View style={br.subRow}>
            <Ionicons name="card-outline" size={16} color="#cbd5e1" />
            <Text style={br.subText} numberOfLines={1}>
              {(bankName?.trim() ? bankName.trim() : "ไม่ระบุธนาคาร")} • {accNorm || "-"}
            </Text>
          </View>

          {fromPostTitle ? (
            <Text style={br.fromPost} numberOfLines={1}>
              จากโพสต์: {fromPostTitle}
            </Text>
          ) : null}
        </View>

        <View style={[br.riskPill, { backgroundColor: riskTone.bg }]}>
          <Text style={[br.riskText, { color: riskTone.fg }]}>{riskLabel}</Text>
        </View>

        <Pressable onPress={onClose} hitSlop={10} style={br.closeBtn}>
          <Ionicons name="close" size={18} color="#e5e7eb" />
        </Pressable>
      </View>

      <View style={br.divider} />

      <Text style={br.sectionTitle}>หมวดรายงาน</Text>

      <View style={br.chipsWrap}>
        <BankReportChip label="Scam" icon="warning-outline" active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
        <BankReportChip
          label="Money Mule"
          icon="swap-horizontal-outline"
          active={category === "MONEY_MULE"}
          onPress={() => setCategory("MONEY_MULE")}
        />
        <BankReportChip
          label="Sales/Ads"
          icon="pricetag-outline"
          active={category === "SALES_ADS"}
          onPress={() => setCategory("SALES_ADS")}
        />
        <BankReportChip
          label="Dispute"
          icon="chatbox-ellipses-outline"
          active={category === "DISPUTE"}
          onPress={() => setCategory("DISPUTE")}
        />
        <BankReportChip label="Other" icon="ellipsis-horizontal" active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
      </View>

      <Text style={[br.sectionTitle, { marginTop: 14 }]}>รายละเอียด (ไม่บังคับ)</Text>

      <View style={br.noteBox}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="เช่น หลอกโอน / ไม่ส่งของ / ใช้บัญชีรับโอน / ทวงเงิน..."
          placeholderTextColor="#6b7280"
          style={br.noteInput}
          multiline
          maxLength={160}
        />
        <Text style={br.counter}>{note.length}/160</Text>
      </View>

      <Pressable onPress={toggleRemember} style={br.rememberRow}>
        <View style={[br.checkbox, rememberLocal && br.checkboxOn]}>
          {rememberLocal ? <Ionicons name="checkmark" size={14} color="#111" /> : null}
        </View>
        <Text style={br.rememberText}>จำว่าเคยรายงานแล้ว (ในเครื่อง)</Text>
      </Pressable>

      <View style={br.actionsRow}>
        <Pressable onPress={onCancel} style={[br.btn, br.btnGhost]} disabled={busy}>
          <Text style={br.btnGhostText}>ยกเลิก</Text>
        </Pressable>

        <Pressable onPress={submit} style={[br.btn, br.btnPrimary, busy && { opacity: 0.7 }]} disabled={busy}>
          <View style={br.btnRow}>
            <Ionicons name="megaphone-outline" size={16} color="#111" />
            <Text style={br.btnPrimaryText}>{busy ? "กำลังส่ง..." : "Report"}</Text>
          </View>
        </Pressable>
      </View>

      <Text style={br.hint}>รายงาน = ส่งข้อมูลให้ระบบ/แอดมินตรวจสอบ (ไม่มีผล block ในเครื่อง)</Text>
    </View>
  );
}

// =======================
// Screen
// =======================
export default function PhoneCenterLookupTab() {
  const navigation = useNavigation<any>();
  useHeaderHeight();

  // ✅ Auth
  const { user, isLoggedIn } = useAuth();
  const userId = String(user?.id ?? "guest");

  // ✅ helper ตามที่คุณต้องการใช้
  const goStack = useCallback(
    (screen: string, params?: any) => {
      navigation.navigate(screen, params);
    },
    [navigation]
  );

  const [lookupType, setLookupType] = useState<LookupType>("PHONE");

  const [q, setQ] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const [history, setHistory] = useState<string[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // PHONE
  const [items, setItems] = useState<ScamPhone[]>([]);
  const [expandedTel, setExpandedTel] = useState<string | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [blockedMap, setBlockedMap] = useState<Record<string, true>>({});
  const [phoneSearched, setPhoneSearched] = useState(false);
  const [lastPhoneTerm, setLastPhoneTerm] = useState<string>("");

  // BANK
  const [bankItems, setBankItems] = useState<ScamBank[]>([]);
  const [expandedAcc, setExpandedAcc] = useState<string | null>(null);
  const [bankSearched, setBankSearched] = useState(false);
  const [lastBankTerm, setLastBankTerm] = useState<string>("");

  const blurTimer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const m = await loadBlockedMap(userId);
      setBlockedMap(m);
    })();
  }, [userId]);

  useEffect(() => {
    (async () => {
      const h = await loadHistory(userId, lookupType);
      setHistory(h);
    })();
  }, [userId, lookupType]);

  const isBlocked = useCallback((telNormalized: string) => !!blockedMap[normalizeTel(telNormalized)], [blockedMap]);

  const onBlock = useCallback(
    async (telNormalized: string) => {
      const tel = normalizeTel(telNormalized);
      if (!tel) return;

      // ✅ เพิ่ม guard อีกชั้น (เผื่อถูกเรียกตรง ๆ)
      if (!isLoggedIn) {
        goStack("SignIn");
        return;
      }

      setBlockedMap((prev) => {
        const next = { ...prev, [tel]: true };
        persistBlockedMap(userId, next);
        return next;
      });
    },
    [userId, isLoggedIn, goStack]
  );

  const onUnblock = useCallback(
    async (telNormalized: string) => {
      const tel = normalizeTel(telNormalized);
      if (!tel) return;

      if (!isLoggedIn) {
        goStack("SignIn");
        return;
      }

      setBlockedMap((prev) => {
        const next = { ...prev };
        delete next[tel];
        persistBlockedMap(userId, next);
        return next;
      });
    },
    [userId, isLoggedIn, goStack]
  );

  const onReportPhone = useCallback(
    async (data: { tel: string; category: ReportCategory; note?: string; postId?: string }) => {
      // ✅ Login guard สำหรับ "รายงาน" ด้วย
      if (!isLoggedIn) {
        goStack("SignIn");
        return;
      }

      const tel = normalizeTel(data.tel);
      if (!tel) return;

      const input = {
        phone: tel,
        note: data.note?.trim() ? data.note.trim() : null,
        local_blocked: isBlocked(tel),
        client_id: genClientId(),
        device_model: null,
        os_version: `${Platform.OS} ${Platform.Version}`,
        app_version: null,
      };

      const res = await client.mutate<{ reportScamPhone: ScamPhone }>({
        mutation: REPORT_SCAM_PHONE,
        variables: { input },
      });

      const updated = res.data?.reportScamPhone;
      if (updated) {
        const norm = normalizeTel(updated.phone);
        setItems((prev) => {
          const next = prev.map((x) => (normalizeTel(x.phone) === norm ? updated : x));
          if (!next.some((x) => normalizeTel(x.phone) === norm)) next.unshift(updated);
          return next;
        });
        setExpandedTel(norm);
      }
    },
    [isLoggedIn, goStack, isBlocked]
  );

  const onReportBank = useCallback(
    async (data: { account: string; bankName?: string | null; category: BankReportCategory; note?: string; postId?: string }) => {
      // ✅ Login guard สำหรับ "รายงาน" ด้วย
      if (!isLoggedIn) {
        goStack("SignIn");
        return;
      }

      const acc = normalizeBankAccount(data.account);
      if (!acc) return;

      const bankNameSafe = String(data.bankName || "").trim() || "UNKNOWN";

      // ถ้า backend บังคับ post_id (ID!) -> กัน null
      const postIdSafe = data.postId ? String(data.postId) : "0";

      const input = {
        account: acc,
        bank_name: bankNameSafe,
        category: data.category,
        note: data.note?.trim() ? data.note.trim() : null,
        client_id: genClientId(),
        device_model: null,
        os_version: `${Platform.OS} ${Platform.Version}`,
        app_version: null,
        post_id: postIdSafe,
      };

      const res = await client.mutate<{ reportScamBankAccount: ScamBank }>({
        mutation: REPORT_SCAM_BANK_ACCOUNT,
        variables: { input },
      });

      const updated = res.data?.reportScamBankAccount;
      if (updated) {
        const norm = normalizeBankAccount(updated.account);
        setBankItems((prev) => {
          const next = prev.map((x) => (normalizeBankAccount(x.account) === norm ? updated : x));
          if (!next.some((x) => normalizeBankAccount(x.account) === norm)) next.unshift(updated);
          return next;
        });
        setExpandedAcc(norm);
      }
    },
    [isLoggedIn, goStack]
  );

  const commitHistory = useCallback(
    async (term: string) => {
      setHistory((prev) => {
        const next = addToHistory(prev, term);
        persistHistory(userId, lookupType, next);
        return next;
      });
    },
    [userId, lookupType]
  );

  const clearHistory = useCallback(async () => {
    setHistory([]);
    await persistHistory(userId, lookupType, []);
  }, [userId, lookupType]);

  const doSearch = useCallback(async () => {
    const raw = q.trim();
    if (!raw) return;

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHistoryOpen(false);

    try {
      if (lookupType === "PHONE") {
        const term = normalizeTel(raw) || raw;

        setPhoneSearched(true);
        setLastPhoneTerm(term);

        setCheckResult(null);
        setExpandedTel(null);
        setItems([]);

        await commitHistory(term);

        const res = await client.query<{ searchScamPhones: ScamPhone[] }>({
          query: SEARCH_SCAM_PHONES,
          variables: { q: term, limit: 30 },
          fetchPolicy: "network-only",
        });

        const list = res.data?.searchScamPhones ?? [];
        setItems(list);

        setLoadingCheck(true);
        try {
          const chk = await checkScamPhoneWithFallback(client, term);
          setCheckResult(chk);
        } finally {
          setLoadingCheck(false);
        }

        if (list.length > 0) {
          const exact = list.find((x) => normalizeTel(x.phone) === normalizeTel(term)) || list[0];
          setExpandedTel(normalizeTel(exact.phone));
        } else {
          setExpandedTel(null);
        }
      } else {
        const term = normalizeBankAccount(raw) || raw;

        setBankSearched(true);
        setLastBankTerm(term);

        setExpandedAcc(null);
        setBankItems([]);

        await commitHistory(term);

        const res = await client.query<{ searchScamBankAccounts: ScamBank[] }>({
          query: SEARCH_SCAM_BANK_ACCOUNTS,
          variables: { q: term, limit: 30 },
          fetchPolicy: "network-only",
        });

        const list = res.data?.searchScamBankAccounts ?? [];
        setBankItems(list);

        if (list.length > 0) {
          const exact = list.find((x) => normalizeBankAccount(x.account) === normalizeBankAccount(term)) || list[0];
          setExpandedAcc(normalizeBankAccount(exact.account));
        } else {
          setExpandedAcc(null);
        }
      }
    } catch (e: any) {
      console.warn("[PhoneCenterLookup][search] error =", e?.message ?? e);
      Alert.alert("ผิดพลาด", "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoadingSearch(false);
    }
  }, [q, lookupType, commitHistory]);

  useLayoutEffect(() => {
    navigation.setOptions?.({
      headerTitle: () => (
        <HeaderSearchBar
          value={q}
          onChangeText={(t) => setQ(t)}
          onSubmit={doSearch}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setHistoryOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {}, 120);
          }}
          onClearInput={() => setQ("")}
          loading={loadingSearch}
          historyOpen={historyOpen}
          onToggleHistory={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setHistoryOpen((v) => !v);
          }}
          placeholder={lookupType === "PHONE" ? "ค้นหาเบอร์..." : "ค้นหาเลขบัญชี..."}
        />
      ),
      headerTitleAlign: "center",
      headerTitleContainerStyle: { width: "100%", left: 0, right: 0, marginHorizontal: 0, paddingHorizontal: 0 },
      headerRight: () => null,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "#0b0f19" },
    });
  }, [navigation, q, doSearch, loadingSearch, historyOpen, lookupType]);

  const filteredHistory = useMemo(() => {
    const term = q.trim();
    if (!term) return history;
    const t = term.toLowerCase();
    return history.filter((x) => String(x).toLowerCase().includes(t));
  }, [history, q]);

  const HeaderList = useMemo(() => {
    const title = lookupType === "PHONE" ? "Phone Center" : "Bank Center";
    const sub = lookupType === "PHONE" ? "Lookup • Expand = Block/Report Panel" : "Lookup • Expand = Report Panel";
    const count = lookupType === "PHONE" ? items.length : bankItems.length;

    return (
      <View style={{ paddingTop: 10, paddingBottom: 10 }}>
        <View style={topTabs.wrap}>
          <View style={topTabs.pill}>
            <Pressable
              onPress={() => {
                setLookupType("PHONE");
                setQ("");
                setItems([]);
                setBankItems([]);
                setExpandedTel(null);
                setExpandedAcc(null);
                setCheckResult(null);
                setPhoneSearched(false);
                setBankSearched(false);
                setLastPhoneTerm("");
                setLastBankTerm("");
              }}
              style={[topTabs.btn, lookupType === "PHONE" && topTabs.btnOn]}
            >
              <Ionicons name="call-outline" size={16} color={lookupType === "PHONE" ? "#111" : "#cbd5e1"} />
              <Text style={[topTabs.text, lookupType === "PHONE" && { color: "#111" }]}>เบอร์</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setLookupType("BANK");
                setQ("");
                setItems([]);
                setBankItems([]);
                setExpandedTel(null);
                setExpandedAcc(null);
                setCheckResult(null);
                setPhoneSearched(false);
                setBankSearched(false);
                setLastPhoneTerm("");
                setLastBankTerm("");
              }}
              style={[topTabs.btn, lookupType === "BANK" && topTabs.btnOn]}
            >
              <Ionicons name="card-outline" size={16} color={lookupType === "BANK" ? "#111" : "#cbd5e1"} />
              <Text style={[topTabs.text, lookupType === "BANK" && { color: "#111" }]}>บัญชี</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroSub}>{sub}</Text>

        {lookupType === "PHONE" ? (
          <>
            {!!checkResult ? (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Summary</Text>
                  <Text style={styles.muted}>{count} results</Text>
                </View>

                {loadingCheck ? (
                  <View style={{ paddingTop: 10 }}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <View style={{ paddingTop: 10 }}>
                    <View style={styles.summaryRow}>
                      <View style={styles.summaryStat}>
                        <Text style={styles.statLabel}>Found</Text>
                        <Text style={styles.statValue}>{checkResult.found ? "YES" : "NO"}</Text>
                      </View>
                      <View style={styles.summaryStat}>
                        <Text style={styles.statLabel}>Risk</Text>
                        <Text style={styles.statValue}>{checkResult.risk}</Text>
                      </View>
                      <View style={styles.summaryStat}>
                        <Text style={styles.statLabel}>Reports</Text>
                        <Text style={styles.statValue}>{checkResult.reportCount}</Text>
                      </View>
                    </View>

                    <Text style={[styles.muted, { marginTop: 10 }]}>
                      {checkResult.found ? riskText(checkResult.risk) : "ไม่พบในระบบ แต่ยัง Block/Report ได้"}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={[styles.muted, { marginTop: 10 }]}>พิมพ์เบอร์ด้านบน แล้วกดค้นหา</Text>
            )}

            <Text style={styles.sectionTitle}>Results (tap to expand)</Text>
          </>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Summary</Text>
                <Text style={styles.muted}>{count} results</Text>
              </View>
              <Text style={[styles.muted, { marginTop: 10 }]}>พิมพ์เลขบัญชีด้านบน แล้วกดค้นหา</Text>
            </View>

            <Text style={styles.sectionTitle}>Results (tap to expand)</Text>
          </>
        )}
      </View>
    );
  }, [lookupType, checkResult, items.length, bankItems.length, loadingCheck]);

  return (
    <View style={styles.container}>
      <HistoryPanelOverlay
        visible={historyOpen}
        top={0}
        left={14}
        right={14}
        items={filteredHistory.slice(0, 8)}
        onPick={(v) => {
          setQ(v);
          setHistoryOpen(false);
          setTimeout(() => doSearch(), 0);
        }}
        onClear={clearHistory}
        onClose={() => setHistoryOpen(false)}
      />

      {lookupType === "PHONE" ? (
        <FlatList
          data={items}
          keyExtractor={(it) => normalizeTel(it.phone) || it.phone}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={HeaderList}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.muted}>ไม่พบผลลัพธ์</Text>
            </View>
          }
          renderItem={({ item }) => {
            const tel = normalizeTel(item.phone);
            const isExpanded = expandedTel === tel;
            const riskScore = clamp(Number(item.risk_level || 0), 0, 100);
            const blocked = isBlocked(tel);

            const riskMeta = computeRiskLabel(item.report_count, riskScore);
            const pillTone = toneStyle(riskMeta.tone);

            return (
              <Pressable
                onPress={() => setExpandedTel((prev) => (prev === tel ? null : tel))}
                style={[styles.singleCard, isExpanded && styles.singleCardActive]}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.telText}>{tel || item.phone}</Text>
                    <Text style={styles.subText}>
                      Risk {riskScore} • {item.report_count} reports • last {fmtTime(item.last_report_at)}
                    </Text>
                  </View>

                  <View style={styles.headerRight}>
                    <View
                      style={[
                        styles.riskBadge,
                        { backgroundColor: blocked ? "#ef4444" : pillTone.bg, borderColor: blocked ? "#ff4d6d" : "#27335f" },
                      ]}
                    >
                      <Text style={[styles.riskBadgeText, { color: blocked ? "#111" : pillTone.fg }]}>
                        {blocked ? "BLOCKED" : riskMeta.label}
                      </Text>
                    </View>

                    <View style={styles.togglePill}>
                      <Text style={styles.toggleText}>{isExpanded ? "HIDE" : "VIEW"}</Text>
                    </View>
                  </View>
                </View>

                {isExpanded ? (
                  <View style={styles.expandWrap}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaText}>Updated: {fmtTime(item.updated_at)}</Text>
                      <Text style={styles.metaText}>Last report: {fmtTime(item.last_report_at)}</Text>
                    </View>

                    <InlineBlockReportPanel
                      tel={tel}
                      postId={item.post_ids?.[0]}
                      title={undefined}
                      reportCount={item.report_count}
                      riskScore={riskScore}
                      isLoggedIn={!!isLoggedIn}
                      goStack={goStack}
                      isBlocked={isBlocked}
                      onBlock={onBlock}
                      onUnblock={onUnblock}
                      onReport={onReportPhone}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={bankItems}
          keyExtractor={(it) => normalizeBankAccount(it.account) || it.account}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={HeaderList}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.muted}>ไม่พบผลลัพธ์</Text>
            </View>
          }
          renderItem={({ item }) => {
            const acc = normalizeBankAccount(item.account);
            const isExpanded = expandedAcc === acc;

            const riskScore = clamp(Number(item.risk_level || 0), 0, 100);
            const riskMeta = computeRiskLabel(item.report_count, riskScore);
            const pillTone = toneStyle(riskMeta.tone);

            return (
              <Pressable
                onPress={() => setExpandedAcc((prev) => (prev === acc ? null : acc))}
                style={[styles.singleCard, isExpanded && styles.singleCardActive]}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.telText}>
                      {item.bank_name ? `${item.bank_name} • ` : ""}
                      {acc || item.account}
                    </Text>
                    <Text style={styles.subText}>
                      Risk {riskScore} • {item.report_count} reports • last {fmtTime(item.last_report_at)}
                    </Text>
                  </View>

                  <View style={styles.headerRight}>
                    <View style={[styles.riskBadge, { backgroundColor: pillTone.bg, borderColor: "#27335f" }]}>
                      <Text style={[styles.riskBadgeText, { color: pillTone.fg }]}>{riskMeta.label}</Text>
                    </View>

                    <View style={styles.togglePill}>
                      <Text style={styles.toggleText}>{isExpanded ? "HIDE" : "VIEW"}</Text>
                    </View>
                  </View>
                </View>

                {isExpanded ? (
                  <View style={styles.expandWrap}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaText}>Updated: {fmtTime(item.updated_at)}</Text>
                      <Text style={styles.metaText}>Last report: {fmtTime(item.last_report_at)}</Text>
                    </View>

                    <BankReportInlineForm
                      userId={userId}
                      account={acc}
                      bankName={item.bank_name ?? null}
                      fromPostTitle={null}
                      isLoggedIn={!!isLoggedIn}
                      goStack={goStack}
                      riskLabel={riskMeta.label}
                      riskTone={pillTone}
                      onClose={() => setExpandedAcc(null)}
                      onCancel={() => setExpandedAcc(null)}
                      onSubmit={async ({ account, bankName, category, note }) => {
                        await onReportBank({
                          account,
                          bankName,
                          category,
                          note,
                          postId: item.post_ids?.[0],
                        });
                      }}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

// =======================
// Styles (Screen)
// =======================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f19", paddingHorizontal: 14 },

  heroTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginTop: 4 },
  heroSub: { color: "#98a2b3", marginTop: 4 },

  sectionTitle: {
    color: "#e5e7eb",
    fontWeight: "900",
    marginTop: 14,
    marginBottom: 10,
    fontSize: 13,
  },

  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1a2240",
    backgroundColor: "#0e1426",
  },
  cardTitle: { color: "#fff", fontWeight: "900" },
  muted: { color: "#98a2b3" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  summaryRow: { flexDirection: "row", gap: 10 },
  summaryStat: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#202a4f",
    backgroundColor: "#0b1020",
  },
  statLabel: { color: "#98a2b3", fontWeight: "700" },
  statValue: { color: "#fff", fontWeight: "900", fontSize: 16, marginTop: 6 },

  emptyBox: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
  },

  singleCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
    marginBottom: 10,
  },
  singleCardActive: {
    borderColor: "#2563eb",
    backgroundColor: "#0f1a39",
  },

  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  telText: { color: "#fff", fontWeight: "950" as any, fontSize: 18 },
  subText: { color: "#98a2b3", marginTop: 4 },

  headerRight: { alignItems: "flex-end", gap: 10 },

  riskBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  riskBadgeText: { fontWeight: "900", letterSpacing: 0.2 },

  togglePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0b1020",
  },
  toggleText: { color: "#c7d2fe", fontWeight: "900" },

  expandWrap: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#1a2240",
    paddingTop: 14,
  },
  metaRow: { gap: 4, marginBottom: 10 },
  metaText: { color: "#98a2b3" },
});

// =======================
// Styles (Navigation header search)
// =======================
const nav = StyleSheet.create({
  headerOuter: { flex: 1, width: "100%" },
  headerPill: {
    flex: 1,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1a2240",
    backgroundColor: "#0e1426",
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    paddingVertical: 0,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: { backgroundColor: "#e5e7eb" },
  miniLoader: { marginLeft: 6 },
});

// =======================
// Styles (History panel)
// =======================
const hp = StyleSheet.create({
  root: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
  },
  backdrop: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  card: {
    position: "absolute",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(18, 21, 30, 0.92)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  clearBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  clearText: { color: "#ff4d6d", fontWeight: "900", fontSize: 14 },

  emptyText: { color: "#98a2b3", paddingHorizontal: 14, paddingBottom: 14 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  rowText: { color: "#fff", fontSize: 20, fontWeight: "900", flex: 1 },
});

// =======================
// Styles (Inline panel UI - phone)
// =======================
const ui = StyleSheet.create({
  panel: {
    backgroundColor: "#0f0f14",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f1f26",
    padding: 12,
  },

  panelHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f26",
  },

  hTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  telRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  telText: { color: "#e5e7eb", fontSize: 15, fontWeight: "900" },
  riskPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  riskPillText: { fontSize: 11, fontWeight: "900" },
  reportCount: { color: "#9ca3af", fontSize: 12, fontWeight: "800" },
  subtle: { color: "#9ca3af", fontSize: 12, marginTop: 6 },

  fastBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#facc15",
    borderWidth: 1,
    borderColor: "#facc15",
  },
  fastBadgeText: { color: "#111", fontWeight: "900", fontSize: 12 },

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
    borderRadius: 14,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1f1f26",
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  counter: { color: "#6b7280", fontSize: 11, marginTop: 6, textAlign: "right" },

  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: "#34c759" },
  btnUnblock: { backgroundColor: "#111116", borderWidth: 1, borderColor: "#2a2a35" },

  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimaryText: { fontSize: 13, fontWeight: "900", color: "#111" },

  hint: { marginTop: 10, color: "#6b7280", fontSize: 11, lineHeight: 15 },
});

// =======================
// Styles (Top tabs)
// =======================
const topTabs = StyleSheet.create({
  wrap: { marginBottom: 10, alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
  },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  btnOn: { backgroundColor: "#e5e7eb" },
  text: { color: "#cbd5e1", fontWeight: "900", fontSize: 14 },
});

// =======================
// Styles (Bank Report Inline UI)
// =======================
const br = StyleSheet.create({
  sheet: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(18, 21, 30, 0.96)",
    overflow: "hidden",
  },
  headRow: {
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "900" },

  subRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  subText: { color: "#e5e7eb", fontSize: 16, fontWeight: "900", flex: 1 },
  fromPost: { marginTop: 8, color: "#9ca3af" },

  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  riskPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, alignSelf: "flex-start" },
  riskText: { fontWeight: "900" },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)" },

  sectionTitle: { color: "#e5e7eb", fontWeight: "900", marginTop: 14, paddingHorizontal: 14 },

  chipsWrap: { paddingHorizontal: 14, marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  chipOn: { backgroundColor: "#34c759", borderColor: "#34c759" },
  chipText: { color: "#e5e7eb", fontSize: 14, fontWeight: "900" },

  noteBox: {
    marginTop: 10,
    marginHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f1f26",
    backgroundColor: "#111116",
    padding: 12,
  },
  noteInput: { minHeight: 64, color: "#e5e7eb", fontSize: 14, lineHeight: 18 },
  counter: { marginTop: 6, color: "#6b7280", fontSize: 12, textAlign: "right", fontWeight: "800" },

  rememberRow: { marginTop: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: "#34c759", borderColor: "#34c759" },
  rememberText: { color: "#e5e7eb", fontWeight: "900", fontSize: 14 },

  actionsRow: { flexDirection: "row", gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  btn: { flex: 1, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: "#111116", borderWidth: 1, borderColor: "#2a2a35" },
  btnGhostText: { color: "#e5e7eb", fontWeight: "900", fontSize: 16 },
  btnPrimary: { backgroundColor: "#34c759" },
  btnPrimaryText: { color: "#111", fontWeight: "900", fontSize: 16 },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  hint: { paddingHorizontal: 14, paddingBottom: 14, color: "#6b7280", fontSize: 12, lineHeight: 16 },
});