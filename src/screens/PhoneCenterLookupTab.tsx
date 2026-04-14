// src/screens/PhoneCenterLookupTab.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import {
  Q_MY_BLOCKED_PHONE_KEYS,
  Q_MY_REPORTED_BANK_ACCOUNT_KEYS,
  useJachoeiStatusKeys,
} from "../hooks/useJachoeiStatusKeys";
import type { TabsParamList } from "../navigation/types";

import { FloatingActionButton } from "../components/FloatingActionButton";
import { HeaderSearchInput } from "../components/HeaderSearchInput";
import { PhoneCard } from "../components/PhoneCard";
import { SpamContactPrompt } from "../components/SpamContactPrompt";
import {
  BlockReportBottomSheet,
  type BlockReportBottomSheetRef,
} from "../components/BlockReportBottomSheet";
import { usePhoneActions } from "../hooks/usePhoneActions";
import { useSpamContactPrompt } from "../hooks/useSpamContactPrompt";

// ======================================================
// GraphQL (PHONE)
// ======================================================
const PHONE_CENTER_SEARCH = gql`
  query PhoneCenterSearch($q: String, $filter: PhoneCenterFilter!, $limit: Int!, $offset: Int!) {
    phoneCenterSearch(q: $q, filter: $filter, limit: $limit, offset: $offset) {
      phone
      phone_normalized
      my_blocked
      my_blocked_at
      my_reported
      my_reported_at
      in_history
      last_history_at
      report_count
      last_report_at
      risk_level
      updated_at
      post_count
      latest_post_id
      post_ids
      filters
    }
  }
`;

const REPORT_NUMBER = gql`
  mutation ReportNumber($phoneNumber: String!, $category: ScamPhoneReportCategory, $note: String) {
    reportNumber(phoneNumber: $phoneNumber, category: $category, note: $note) {
      ok
      item {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
        my_reported
        my_reported_at
        in_history
        last_history_at
        report_count
        last_report_at
        risk_level
        updated_at
        post_count
        latest_post_id
        post_ids
        filters
      }
    }
  }
`;

const BLOCK_NUMBER = gql`
  mutation BlockNumber($phoneNumber: String!) {
    blockNumber(phoneNumber: $phoneNumber) {
      ok
      item {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
        my_reported
        my_reported_at
        in_history
        last_history_at
        report_count
        last_report_at
        risk_level
        updated_at
        post_count
        latest_post_id
        post_ids
        filters
      }
    }
  }
`;

const UNBLOCK_NUMBER = gql`
  mutation UnblockNumber($phoneNumber: String!) {
    unblockNumber(phoneNumber: $phoneNumber) {
      ok
      item {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
        my_reported
        my_reported_at
        in_history
        last_history_at
        report_count
        last_report_at
        risk_level
        updated_at
        post_count
        latest_post_id
        post_ids
        filters
      }
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
      post_count
      latest_post_id
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

type PhoneCenterFilter = "ALL" | "BLOCKED" | "REPORTS" | "HISTORY";

type PhoneCenterItem = {
  phone: string;
  phone_normalized: string;
  my_blocked: boolean;
  my_blocked_at: string | null;
  my_reported: boolean;
  my_reported_at: string | null;
  in_history: boolean;
  last_history_at: string | null;
  report_count: number;
  last_report_at: string | null;
  risk_level: number;
  updated_at: string;
  post_count: number;
  latest_post_id: string | null;
  post_ids: string[];
  filters: string[];
};

type PhoneCenterActionPayload = {
  ok: boolean;
  item: PhoneCenterItem;
};

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
  post_count: number;
  latest_post_id: string | null;
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
  post_count: number;
  latest_post_id: string | null;
  ctx?: any;
};

type CheckResult = {
  found: boolean;
  risk: number;
  reportCount: number;
  blocked: boolean;
  reported: boolean;
  inHistory: boolean;
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

function matchesPhoneCenterFilter(item: PhoneCenterItem, filter: PhoneCenterFilter) {
  if (filter === "BLOCKED") return item.my_blocked;
  if (filter === "REPORTS") return item.my_reported || item.report_count > 0;
  if (filter === "HISTORY") return item.in_history;
  return true;
}

function requiresAuthForPhoneCenterFilter(filter: PhoneCenterFilter) {
  return filter === "BLOCKED" || filter === "HISTORY";
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
// Navigation Header Search Wrapper (FULL WIDTH with history inside)
// =======================
function HeaderSearchWrapper(props: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClearInput: () => void;
  loading?: boolean;
  placeholder?: string;
  hasHistory: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  const { value, onChangeText, onSubmit, onFocus, onBlur, onClearInput, loading, placeholder, hasHistory, historyOpen, onToggleHistory } = props;

  // 🔍 DEBUG: Verify this component renders on real device
  useEffect(() => {
    console.log("[HeaderSearchWrapper] 🎯 RENDERED - in-screen search (NOT header slot)");
  }, []);

  return (
    <View style={searchStyles.headerSearchContainer}>
      <View style={searchStyles.searchInputWrapper}>
        <HeaderSearchInput
          value={value}
          onChangeText={onChangeText}
          onClear={onClearInput}
          onFocus={onFocus}
          onBlur={onBlur}
          showHistoryIcon={false}
          loading={loading}
          placeholder={placeholder || "ค้นหา..."}
          autoFocus={false}
          onSubmit={onSubmit}
        />
      </View>
      
      {hasHistory && (
        <Pressable 
          onPress={onToggleHistory}
          hitSlop={10}
          style={searchStyles.headerHistoryBtnInline}
        >
          <Ionicons 
            name="time-outline" 
            size={22} 
            color={historyOpen ? "#fbbf24" : "#cbd5e1"} 
          />
        </Pressable>
      )}
    </View>
  );
}

// =======================
// History Dropdown Panel (renders below header as dropdown)
// =======================
function HistoryDropdownPanel(props: {
  visible: boolean;
  items: string[];
  onPick: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { visible, items, onPick, onClear, onClose } = props;
  if (!visible) return null;

  const maxH = Math.min(280, Math.round(Dimensions.get("window").height * 0.4));

  return (
    <>
      {/* Backdrop to close on outside tap */}
      <Pressable style={searchStyles.dropdownBackdrop} onPress={onClose} />
      
      {/* Dropdown panel */}
      <View style={[searchStyles.dropdownPanel, { maxHeight: maxH }]}>
        <View style={searchStyles.dropdownHeader}>
          <Ionicons name="time-outline" size={18} color="#cbd5e1" />
          <Text style={searchStyles.dropdownTitle}>ประวัติการค้นหา</Text>
          
          {items.length > 0 && (
            <Pressable onPress={onClear} hitSlop={10} style={searchStyles.dropdownClearBtn}>
              <Text style={searchStyles.dropdownClearText}>ล้าง</Text>
            </Pressable>
          )}
        </View>

        {items.length === 0 ? (
          <Text style={searchStyles.dropdownEmpty}>ยังไม่มีประวัติการค้นหา</Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item)} style={searchStyles.historyItem}>
                <Ionicons name="search-outline" size={16} color="#6b7280" />
                <Text style={searchStyles.historyItemText} numberOfLines={1}>
                  {item}
                </Text>
                <Ionicons name="arrow-forward" size={14} color="#4b5563" />
              </Pressable>
            )}
          />
        )}
      </View>
    </>
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
  const { t } = useI18n();

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
  const {
    prompt,
    busy: spamPromptBusy,
    contactMatch,
    inspectPhone,
    requestPromptForCurrent,
    onConfirmSpam,
    onSkip,
    onDontAskAgain,
    unmarkCurrentContact,
  } = useSpamContactPrompt();

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

  useEffect(() => {
    if (!telNorm) return;
    void inspectPhone(telNorm);
  }, [inspectPhone, telNorm]);

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

      {contactMatch?.found && !contactMatch.spamMarked ? (
        <Pressable onPress={requestPromptForCurrent} style={[ui.btn, ui.btnSecondary, { marginTop: 10 }]}>
          <View style={ui.btnRow}>
            <Ionicons name="person-add-outline" size={16} color="#fbbf24" />
            <Text style={ui.btnSecondaryText}>{t("button.mark_as_spam")}</Text>
          </View>
        </Pressable>
      ) : null}

      {contactMatch?.spamMarked ? (
        <Pressable
          onPress={() => {
            void unmarkCurrentContact();
          }}
          style={[ui.btn, ui.btnSecondary, { marginTop: 10 }]}
        >
          <View style={ui.btnRow}>
            <Ionicons name="person-remove-outline" size={16} color="#fbbf24" />
            <Text style={ui.btnSecondaryText}>{t("button.remove_spam_mark")}</Text>
          </View>
        </Pressable>
      ) : null}

      <Text style={ui.hint}>
        Risk tip: {fallbackRiskScore} • {riskText(fallbackRiskScore)}
      </Text>

      <SpamContactPrompt
        visible={prompt.visible}
        phone={prompt.phone}
        displayName={prompt.contact?.displayName}
        busy={spamPromptBusy}
        onConfirmSpam={() => {
          void onConfirmSpam();
        }}
        onSkip={onSkip}
        onDontAskAgain={() => {
          void onDontAskAgain();
        }}
      />
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

function BankResultIconButton(props: {
  icon: string;
  tone: "neutral" | "warning";
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const { icon, tone, onPress, disabled, accessibilityLabel } = props;
  const iconColor = tone === "warning" ? "#f59e0b" : "#e5e7eb";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={(event) => {
        event.stopPropagation?.();
        onPress();
      }}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [
        styles.bankIconButton,
        tone === "warning" ? styles.bankIconButtonWarning : styles.bankIconButtonNeutral,
        disabled && styles.bankIconButtonDisabled,
        pressed && !disabled ? styles.bankIconButtonPressed : null,
      ]}
    >
      <Ionicons name={icon as any} size={20} color={iconColor} />
    </Pressable>
  );
}

// =======================
// Screen
// =======================
export default function PhoneCenterLookupTab() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<TabsParamList, "CheckPhone">>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const actionSheetRef = useRef<BlockReportBottomSheetRef>(null);
  const phoneListRef = useRef<FlatList<PhoneCenterItem> | null>(null);
  const bankListRef = useRef<FlatList<ScamBank> | null>(null);
  const phoneScrollOffsetRef = useRef(0);
  const bankScrollOffsetRef = useRef(0);

  // 🔍 DEBUG: Real device verification logs
  useEffect(() => {
    console.log("[PhoneCenterLookup] 🚀 SCREEN MOUNTED");
    console.log("[PhoneCenterLookup] Platform:", Platform.OS, Platform.Version);
    console.log("[PhoneCenterLookup] Screen dimensions:", Dimensions.get("window"));
    console.log("[PhoneCenterLookup] Safe area insets:", insets);
    console.log("[PhoneCenterLookup] Header height:", headerHeight);
    console.log("[PhoneCenterLookup] ✅ RENDER PATH: screen-content (in-screen search, NO headerTitle)");
  }, []);

  // ✅ Auth
  const { user, isLoggedIn } = useAuth();
  const { t } = useI18n();
  const userId = String(user?.id ?? "guest");
  const { isBlockedTel: isBlockedTelServer } = useJachoeiStatusKeys({ enabled: isLoggedIn });
  const { blockPhone, unblockPhone, reportPhone } = usePhoneActions();

  // ✅ helper ตามที่คุณต้องการใช้
  const goStack = useCallback(
    (screen: string, params?: any) => {
      navigation.navigate(screen, params);
    },
    [navigation]
  );

  const openPhoneDetail = useCallback(
    (item: PhoneCenterItem) => {
      goStack("EntityDetail", { entityType: "PHONE", phone: item.phone_normalized || item.phone });
    },
    [goStack]
  );

  const openBankDetail = useCallback(
    (item: ScamBank) => {
      goStack("EntityDetail", {
        entityType: "BANK",
        bankCode: item.bank_name || "UNKNOWN",
        accountNo: normalizeBankAccount(item.account),
        bankName: item.bank_name || "UNKNOWN",
      });
    },
    [goStack]
  );

  const openLinkedPosts = useCallback(
    (postCount: number, latestPostId?: string | null, fallback?: () => void) => {
      if (postCount === 1 && latestPostId) {
        goStack("PostView", { id: String(latestPostId), currentUserId: user?.id });
        return;
      }
      fallback?.();
    },
    [goStack, user?.id]
  );

  const [lookupType, setLookupType] = useState<LookupType>("PHONE");

  const [phoneQuery, setPhoneQuery] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const [phoneHistory, setPhoneHistory] = useState<string[]>([]);
  const [bankHistory, setBankHistory] = useState<string[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // PHONE
  const [phoneCenterItems, setPhoneCenterItems] = useState<PhoneCenterItem[]>([]);
  const [expandedTel, setExpandedTel] = useState<string | null>(null);
  const [phoneCenterLoading, setPhoneCenterLoading] = useState(false);
  const [phoneCenterRefreshing, setPhoneCenterRefreshing] = useState(false);
  const [phoneCenterFilter, setPhoneCenterFilter] = useState<PhoneCenterFilter>("ALL");
  const [phoneActionBusy, setPhoneActionBusy] = useState<Record<string, "block" | "unblock" | "report" | null>>({});
  const [phoneSearched, setPhoneSearched] = useState(false);
  const [lastPhoneTerm, setLastPhoneTerm] = useState<string>("");
  const phoneFilterNeedsLogin = !isLoggedIn && requiresAuthForPhoneCenterFilter(phoneCenterFilter);

  // BANK
  const [bankItems, setBankItems] = useState<ScamBank[]>([]);
  const [expandedAcc, setExpandedAcc] = useState<string | null>(null);
  const [bankSearched, setBankSearched] = useState(false);
  const [lastBankTerm, setLastBankTerm] = useState<string>("");

  const blurTimer = useRef<any>(null);

  const switchLookupType = useCallback((nextType: LookupType) => {
    setLookupType(nextType);
    setHistoryOpen(false);
  }, []);

  const currentQuery = lookupType === "PHONE" ? phoneQuery : bankQuery;
  const currentHistory = lookupType === "PHONE" ? phoneHistory : bankHistory;

  const setActiveQuery = useCallback((value: string) => {
    if (lookupType === "PHONE") {
      setPhoneQuery(value);
      return;
    }
    setBankQuery(value);
  }, [lookupType]);

  useEffect(() => {
    (async () => {
      const [phoneSaved, bankSaved] = await Promise.all([
        loadHistory(userId, "PHONE"),
        loadHistory(userId, "BANK"),
      ]);
      setPhoneHistory(phoneSaved);
      setBankHistory(bankSaved);
    })();
  }, [userId]);

  useEffect(() => {
    const nextType = route.params?.initialLookupType;
    if (!nextType) return;

    switchLookupType(nextType);
    navigation.setParams?.({ initialLookupType: undefined });
  }, [navigation, route.params?.initialLookupType, switchLookupType]);

  const sortPhoneCenterItems = useCallback(
    (list: PhoneCenterItem[], explicitTerm?: string) => {
      const exactTerm = normalizeTel(explicitTerm ?? lastPhoneTerm);
      return [...list].sort((a, b) => {
        const aExact = exactTerm && a.phone_normalized === exactTerm ? 1 : 0;
        const bExact = exactTerm && b.phone_normalized === exactTerm ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aTime = new Date(a.updated_at || a.last_history_at || a.my_reported_at || a.my_blocked_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.last_history_at || b.my_reported_at || b.my_blocked_at || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        if (a.risk_level !== b.risk_level) return b.risk_level - a.risk_level;
        if (a.report_count !== b.report_count) return b.report_count - a.report_count;
        return a.phone_normalized.localeCompare(b.phone_normalized);
      });
    },
    [lastPhoneTerm]
  );

  const isBlocked = useCallback(
    (telNormalized: string) => {
      const local = phoneCenterItems.find((item) => item.phone_normalized === telNormalized);
      if (local) return !!local.my_blocked;
      return isBlockedTelServer(telNormalized);
    },
    [isBlockedTelServer, phoneCenterItems]
  );

  const upsertPhoneCenterItem = useCallback(
    (item: PhoneCenterItem, explicitTerm?: string) => {
      const normalized = normalizeTel(item.phone_normalized || item.phone);
      if (!normalized) return;

      setPhoneCenterItems((prev) => {
        const remaining = prev.filter((entry) => normalizeTel(entry.phone_normalized || entry.phone) !== normalized);
        if (!matchesPhoneCenterFilter(item, phoneCenterFilter)) {
          return sortPhoneCenterItems(remaining, explicitTerm);
        }
        return sortPhoneCenterItems([{ ...item, phone_normalized: normalized }, ...remaining], explicitTerm);
      });

      setExpandedTel(normalized);
    },
    [phoneCenterFilter, sortPhoneCenterItems]
  );

  const fetchPhoneCenter = useCallback(
    async (term: string, mode: "load" | "refresh" = "load") => {
      if (!isLoggedIn && requiresAuthForPhoneCenterFilter(phoneCenterFilter)) {
        setPhoneCenterItems([]);
        setExpandedTel(null);
        setPhoneCenterRefreshing(false);
        setPhoneCenterLoading(false);
        return;
      }

      if (mode === "refresh") setPhoneCenterRefreshing(true);
      else setPhoneCenterLoading(true);

      try {
        const trimmed = String(term || "").trim();
        const normalized = normalizeTel(trimmed) || trimmed;
        const res = await client.query<{ phoneCenterSearch: PhoneCenterItem[] }>({
          query: PHONE_CENTER_SEARCH,
          variables: {
            q: normalized || null,
            filter: phoneCenterFilter,
            limit: 40,
            offset: 0,
          },
          fetchPolicy: "network-only",
        });

        const list = (res.data?.phoneCenterSearch ?? []).map((item) => ({
          ...item,
          phone_normalized: normalizeTel(item.phone_normalized || item.phone),
        }));

        setPhoneCenterItems(sortPhoneCenterItems(list, normalized));

        if (list.length > 0) {
          const exact = list.find((item) => item.phone_normalized === normalizeTel(normalized)) || list[0];
          setExpandedTel(exact.phone_normalized || normalizeTel(exact.phone));
        } else {
          setExpandedTel(null);
        }
      } catch (e: any) {
        console.warn("[PhoneCenterLookup][phoneCenterSearch] error =", e?.message ?? e);
        Alert.alert("ผิดพลาด", "โหลด Phone Center ไม่สำเร็จ ลองใหม่อีกครั้ง");
      } finally {
        if (mode === "refresh") setPhoneCenterRefreshing(false);
        else setPhoneCenterLoading(false);
      }
    },
    [isLoggedIn, phoneCenterFilter, sortPhoneCenterItems]
  );

  const checkResult = useMemo<CheckResult | null>(() => {
    if (!phoneSearched) return null;

    const exact = phoneCenterItems.find((item) => item.phone_normalized === normalizeTel(lastPhoneTerm));
    if (!exact) {
      return {
        found: false,
        risk: 0,
        reportCount: 0,
        blocked: false,
        reported: false,
        inHistory: false,
      };
    }

    return {
      found: exact.report_count > 0 || exact.my_blocked || exact.my_reported || exact.in_history,
      risk: exact.risk_level,
      reportCount: exact.report_count,
      blocked: exact.my_blocked,
      reported: exact.my_reported,
      inHistory: exact.in_history,
    };
  }, [lastPhoneTerm, phoneCenterItems, phoneSearched]);

  useEffect(() => {
    if (lookupType !== "PHONE") return;
    void fetchPhoneCenter(phoneSearched ? lastPhoneTerm : "");
  }, [fetchPhoneCenter, isLoggedIn, lastPhoneTerm, phoneCenterFilter, phoneSearched, lookupType]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (lookupType === "PHONE") {
        phoneListRef.current?.scrollToOffset({ offset: phoneScrollOffsetRef.current, animated: false });
        return;
      }
      bankListRef.current?.scrollToOffset({ offset: bankScrollOffsetRef.current, animated: false });
    });
  }, [lookupType]);

  const onBlock = useCallback(
    async (telNormalized: string) => {
      const tel = normalizeTel(telNormalized);
      if (!tel) return;
      setPhoneActionBusy((prev) => ({ ...prev, [tel]: "block" }));
      try {
        const updated = await blockPhone({
          phone: tel,
          source: "phone_center_card",
          rawPhone: tel,
          syncServer: isLoggedIn,
        });
        upsertPhoneCenterItem(updated as any, tel);
      } finally {
        setPhoneActionBusy((prev) => ({ ...prev, [tel]: null }));
      }
    },
    [blockPhone, isLoggedIn, upsertPhoneCenterItem]
  );

  const onUnblock = useCallback(
    async (telNormalized: string) => {
      const tel = normalizeTel(telNormalized);
      if (!tel) return;
      setPhoneActionBusy((prev) => ({ ...prev, [tel]: "unblock" }));
      try {
        const updated = await unblockPhone({
          phone: tel,
          source: "phone_center_card",
          rawPhone: tel,
          syncServer: isLoggedIn,
        });
        upsertPhoneCenterItem(updated as any, tel);
      } finally {
        setPhoneActionBusy((prev) => ({ ...prev, [tel]: null }));
      }
    },
    [isLoggedIn, unblockPhone, upsertPhoneCenterItem]
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

      setPhoneActionBusy((prev) => ({ ...prev, [tel]: "report" }));
      try {
        const updated = await reportPhone({
          phone: tel,
          category: data.category,
          note: data.note,
          source: "phone_center_card",
          rawPhone: tel,
        });
        upsertPhoneCenterItem(updated as any, tel);
      } finally {
        setPhoneActionBusy((prev) => ({ ...prev, [tel]: null }));
      }
    },
    [goStack, isLoggedIn, reportPhone, upsertPhoneCenterItem]
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
        refetchQueries: [{ query: Q_MY_REPORTED_BANK_ACCOUNT_KEYS }],
        awaitRefetchQueries: true,
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
      if (lookupType === "PHONE") {
        setPhoneHistory((prev) => {
          const next = addToHistory(prev, term);
          void persistHistory(userId, "PHONE", next);
          return next;
        });
        return;
      }

      setBankHistory((prev) => {
        const next = addToHistory(prev, term);
        void persistHistory(userId, "BANK", next);
        return next;
      });
    },
    [userId, lookupType]
  );

  const clearHistory = useCallback(async () => {
    if (lookupType === "PHONE") {
      setPhoneHistory([]);
      await persistHistory(userId, "PHONE", []);
      return;
    }

    setBankHistory([]);
    await persistHistory(userId, "BANK", []);
  }, [userId, lookupType]);

  const doSearch = useCallback(async () => {
    const raw = currentQuery.trim();
    if (!raw) return;

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHistoryOpen(false);

    try {
      if (lookupType === "PHONE") {
        const term = normalizeTel(raw) || raw;

        setPhoneSearched(true);
        setLastPhoneTerm(term);
        setExpandedTel(null);
        setPhoneCenterItems([]);

        await commitHistory(term);
        await fetchPhoneCenter(term);
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
  }, [currentQuery, lookupType, commitHistory, fetchPhoneCenter]);

  // ✅ headerShown: false is now set at screen registration (ScamProtectTabs.tsx)
  // This prevents race condition where header appears briefly before being hidden
  // No longer need useLayoutEffect - header is never shown in the first place

  const filteredHistory = useMemo(() => {
    const term = currentQuery.trim();
    if (!term) return currentHistory;
    const t = term.toLowerCase();
    return currentHistory.filter((x) => String(x).toLowerCase().includes(t));
  }, [currentHistory, currentQuery]);

  const HeaderList = useMemo(() => {
    const title = lookupType === "PHONE" ? "Phone Center" : "Bank Center";
    const sub = lookupType === "PHONE" ? "Search • Filter • Block / Unblock / Report" : "Lookup • Expand = Report Panel";
    const count = lookupType === "PHONE" ? phoneCenterItems.length : bankItems.length;

    return (
      <View style={styles.headerSection}>
        <View style={styles.headerInner}>
          {/* Type tabs row (เบอร์ / บัญชี) */}
          <View style={topTabs.wrap}>
            <View style={topTabs.pill}>
              <Pressable
                onPress={() => switchLookupType("PHONE")}
                style={[topTabs.btn, lookupType === "PHONE" && topTabs.btnOn]}
              >
                <Ionicons name="call-outline" size={15} color={lookupType === "PHONE" ? "#111" : "#cbd5e1"} />
                <Text style={[topTabs.text, lookupType === "PHONE" && { color: "#111" }]}>เบอร์</Text>
              </Pressable>

              <Pressable
                onPress={() => switchLookupType("BANK")}
                style={[topTabs.btn, lookupType === "BANK" && topTabs.btnOn]}
              >
                <Ionicons name="card-outline" size={15} color={lookupType === "BANK" ? "#111" : "#cbd5e1"} />
                <Text style={[topTabs.text, lookupType === "BANK" && { color: "#111" }]}>บัญชี</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSub}>{sub}</Text>

          {lookupType === "PHONE" ? (
            <>
              <View style={styles.filterPillsRow}>
                {(["ALL", "BLOCKED", "REPORTS", "HISTORY"] as PhoneCenterFilter[]).map((filterKey) => {
                  const active = phoneCenterFilter === filterKey;
                  const icon =
                    filterKey === "BLOCKED"
                      ? "lock-closed-outline"
                      : filterKey === "REPORTS"
                      ? "megaphone-outline"
                      : filterKey === "HISTORY"
                      ? "time-outline"
                      : "albums-outline";

                  return (
                    <Pressable
                      key={filterKey}
                      onPress={() => setPhoneCenterFilter(filterKey)}
                      style={[styles.filterPill, active && styles.filterPillOn]}
                    >
                      <Ionicons name={icon as any} size={14} color={active ? "#111" : "#cbd5e1"} />
                      <Text style={[styles.filterPillText, active && styles.filterPillTextOn]}>{filterKey}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {!!checkResult ? (
                !phoneFilterNeedsLogin ? (
                  <View style={styles.summarySectionFlat}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>Summary</Text>
                      <Text style={styles.muted}>{count} results</Text>
                    </View>

                    {phoneCenterLoading ? (
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
                            <Text style={styles.statLabel}>State</Text>
                            <Text style={styles.statValue}>
                              {checkResult.blocked ? "BLOCKED" : checkResult.reported ? "REPORTED" : checkResult.inHistory ? "HISTORY" : checkResult.reportCount}
                            </Text>
                          </View>
                        </View>

                        <Text style={[styles.muted, { marginTop: 10 }]}> 
                          {checkResult.found
                            ? `${riskText(checkResult.risk)} • reports ${checkResult.reportCount}`
                            : "ไม่พบในระบบ แต่ยัง Block/Report ได้"}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null
              ) : (
                !phoneFilterNeedsLogin ? (
                  <Text style={[styles.muted, { marginTop: 10 }]}>พิมพ์เบอร์ด้านบน หรือใช้ filter เพื่อดู Blocked / Reports / History</Text>
                ) : null
              )}

              {!phoneFilterNeedsLogin ? <Text style={styles.sectionTitle}>Phone Center List (tap to open details)</Text> : null}
            </>
          ) : (
            <>
              <View style={styles.bankSummarySection}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>Summary</Text>
                  <Text style={styles.muted}>{count} results</Text>
                </View>
                <Text style={styles.bankSummaryHint}>พิมพ์เลขบัญชีด้านบน แล้วกดค้นหา</Text>
              </View>

              <Text style={styles.bankResultsTitle}>Results (tap to open details)</Text>
            </>
          )}
        </View>
      </View>
    );
  }, [bankItems.length, checkResult, lookupType, phoneCenterFilter, phoneCenterItems.length, phoneCenterLoading, phoneFilterNeedsLogin, switchLookupType]);

  return (
    <View style={styles.container}>
      {/* Search area wrapper with dropdown positioning context */}
      <View style={searchStyles.searchAreaWrapper}>
        {/* Search bar moved to content (no longer in navigation header) */}
        <View style={[searchStyles.inContentSearchWrapper, { paddingTop: insets.top + 6 }]}>
          <View style={searchStyles.searchRow}>
            <HeaderSearchWrapper
              value={currentQuery}
              onChangeText={setActiveQuery}
              onSubmit={doSearch}
              onFocus={() => {
                if (blurTimer.current) clearTimeout(blurTimer.current);
                if (currentHistory.length > 0) {
                  setHistoryOpen(true);
                }
              }}
              onBlur={() => {
                blurTimer.current = setTimeout(() => {
                  setHistoryOpen(false);
                }, 200);
              }}
              onClearInput={() => {
                if (lookupType === "PHONE") {
                  setPhoneQuery("");
                  setPhoneSearched(false);
                  setLastPhoneTerm("");
                } else {
                  setBankQuery("");
                  setBankSearched(false);
                  setLastBankTerm("");
                  setBankItems([]);
                  setExpandedAcc(null);
                }
              }}
              loading={loadingSearch}
              placeholder={lookupType === "PHONE" ? "ค้นหาเบอร์..." : "ค้นหาเลขบัญชี..."}
              hasHistory={true}
              historyOpen={historyOpen}
              onToggleHistory={() => {
                if (blurTimer.current) clearTimeout(blurTimer.current);
                setHistoryOpen((v) => !v);
              }}
            />
          </View>
      </View>

      {/* History dropdown panel - positioned relative to search wrapper */}
      {historyOpen && (
        <HistoryDropdownPanel
          visible={historyOpen}
          items={filteredHistory.slice(0, 10)}
          onPick={(v) => {
            setActiveQuery(v);
            setHistoryOpen(false);
            setTimeout(() => doSearch(), 0);
          }}
          onClear={clearHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </View>

      {lookupType === "PHONE" ? (
        phoneFilterNeedsLogin ? (
          <View style={styles.phoneLockedContainer}>
            {HeaderList}
            <View style={styles.authRequiredCenterArea}>
              <View style={styles.authRequiredCard}>
                <View style={styles.authRequiredIconWrap}>
                  <Ionicons name="lock-closed-outline" size={24} color="#fbbf24" />
                </View>
                <Text style={styles.authRequiredTitle}>{t("auth.sign_in_to_continue")}</Text>
                <Text style={styles.authRequiredText}>{t("auth.tab_requires_login")}</Text>
                <Pressable onPress={() => goStack("SignIn")} style={styles.authRequiredButton}>
                  <Text style={styles.authRequiredButtonText}>{t("auth.sign_in")}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
        <FlatList
          ref={phoneListRef}
          data={phoneCenterItems}
          keyExtractor={(it) => it.phone_normalized || normalizeTel(it.phone) || it.phone}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={HeaderList}
          contentContainerStyle={styles.phoneListContent}
          refreshControl={
            <RefreshControl
              refreshing={phoneCenterRefreshing}
              onRefresh={() => {
                void fetchPhoneCenter(phoneSearched ? lastPhoneTerm : "", "refresh");
              }}
              tintColor="#fff"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.muted}>ไม่พบรายการใน Phone Center</Text>
            </View>
          }
          onScroll={(event) => {
            phoneScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            const tel = normalizeTel(item.phone_normalized || item.phone);
            return (
              <PhoneCard
                item={{ ...(item as any), tags: [] }}
                busyAction={phoneActionBusy[tel] ?? null}
                onPress={() => openPhoneDetail(item)}
                onViewPosts={() => openLinkedPosts(item.post_count, item.latest_post_id, () => openPhoneDetail(item))}
                onBlock={onBlock}
                onUnblock={onUnblock}
                onReport={(phone: string) => {
                  actionSheetRef.current?.open({
                    mode: "report",
                    phone,
                    title: "Report number",
                  });
                }}
              />
            );
          }}
        />
        )
      ) : (
        <FlatList
          ref={bankListRef}
          data={bankItems}
          keyExtractor={(it) => normalizeBankAccount(it.account) || it.account}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={HeaderList}
          contentContainerStyle={styles.bankListContent}
          ListEmptyComponent={
            <View style={[styles.bankResultRow, styles.bankEmptyRow]}>
              <Text style={styles.muted}>ไม่พบผลลัพธ์</Text>
            </View>
          }
          onScroll={(event) => {
            bankScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            const acc = normalizeBankAccount(item.account);

            const riskScore = clamp(Number(item.risk_level || 0), 0, 100);
            const riskMeta = computeRiskLabel(item.report_count, riskScore);
            const pillTone = toneStyle(riskMeta.tone);

            return (
              <Pressable
                onPress={() => openBankDetail(item)}
                style={styles.bankResultRow}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={styles.bankCardContent}>
                    <Text style={styles.telText}>
                      {item.bank_name ? `${item.bank_name} • ` : ""}
                      {acc || item.account}
                    </Text>
                    <Text style={styles.subText}>
                      Risk {riskScore} • {item.report_count} reports • last {fmtTime(item.last_report_at)}
                    </Text>
                    {item.post_count > 0 ? (
                      <Text style={styles.linkedPostsText}>
                        {item.post_count} linked post{item.post_count > 1 ? "s" : ""}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.bankActionColumn}>
                    <View style={[styles.riskBadge, { backgroundColor: pillTone.bg, borderColor: "#27335f" }]}>
                      <Text style={[styles.riskBadgeText, { color: pillTone.fg }]}>{riskMeta.label}</Text>
                    </View>

                    <View style={styles.bankActionIcons}>
                      <BankResultIconButton
                        icon="eye-outline"
                        tone="neutral"
                        onPress={() => openLinkedPosts(item.post_count, item.latest_post_id, () => openBankDetail(item))}
                        disabled={item.post_count <= 0}
                        accessibilityLabel={item.post_count <= 1 ? "View post" : `View ${item.post_count} posts`}
                      />
                      <BankResultIconButton
                        icon="warning-outline"
                        tone="warning"
                        onPress={() =>
                          void onReportBank({
                            account: acc,
                            bankName: item.bank_name ?? null,
                            category: "SCAM",
                            note: undefined,
                            postId: item.post_ids?.[0],
                          })
                        }
                        accessibilityLabel="Report bank account"
                      />
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {lookupType === "PHONE" ? (
        <FloatingActionButton
          onPress={() => actionSheetRef.current?.open({ mode: "menu", title: "Quick Actions" })}
          accessibilityLabel="Phone Center quick actions"
        />
      ) : null}

      <BlockReportBottomSheet
        ref={actionSheetRef}
        onCheck={(phone) => {
          setPhoneQuery(phone);
          setHistoryOpen(false);
          setTimeout(() => {
            setPhoneQuery(phone);
            setPhoneSearched(true);
            setLastPhoneTerm(phone);
            void fetchPhoneCenter(phone);
          }, 0);
        }}
        onBlock={async (phone) => {
          await onBlock(phone);
        }}
        onReport={async ({ phone, category, note }) => {
          await onReportPhone({ tel: phone, category, note });
        }}
      />
    </View>
  );
}

// =======================
// Styles (Screen)
// =======================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f19" },
  phoneLockedContainer: { flex: 1 },
  headerSection: { paddingTop: 10, paddingBottom: 8 },
  headerInner: { paddingHorizontal: 16 },
  phoneListContent: { paddingBottom: 120, paddingHorizontal: 0 },
  bankListContent: { paddingBottom: 36, paddingHorizontal: 0 },
  heroTitle: { color: "#F8FAFC", fontSize: 18, fontWeight: "900", marginTop: 0, letterSpacing: 0.2 },
  heroSub: { color: "#94A3B8", marginTop: 2, lineHeight: 18 },

  filterPillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14, marginBottom: 6 },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#273244",
    backgroundColor: "#111827",
  },
  filterPillOn: { backgroundColor: "#E2E8F0", borderColor: "#E2E8F0" },
  filterPillText: { color: "#CBD5E1", fontWeight: "800", fontSize: 11 },
  filterPillTextOn: { color: "#111" },

  sectionTitle: {
    color: "#E5E7EB",
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 12,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  bankResultsTitle: {
    color: "#E5E7EB",
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 10,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "#1B2538",
    backgroundColor: "#111827",
  },
  cardTitle: { color: "#F8FAFC", fontWeight: "900", fontSize: 15 },
  muted: { color: "#94A3B8", lineHeight: 18 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summarySectionFlat: {
    marginTop: 14,
    paddingTop: 2,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  bankSummarySection: {
    marginTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  bankSummaryHint: {
    color: "#94A3B8",
    lineHeight: 18,
    marginTop: 10,
  },

  summaryRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  summaryStat: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#22304A",
    backgroundColor: "#0D1526",
  },
  statLabel: { color: "#94A3B8", fontWeight: "700", fontSize: 12 },
  statValue: { color: "#F8FAFC", fontWeight: "900", fontSize: 16, marginTop: 6 },

  emptyBox: {
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "#182235",
    backgroundColor: "#0F172A",
  },
  authRequiredCenterArea: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  authRequiredCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#273244",
    backgroundColor: "#0f172a",
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 10,
  },
  authRequiredIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  authRequiredTitle: { color: "#F8FAFC", fontSize: 17, fontWeight: "900", textAlign: "center" },
  authRequiredText: { color: "#94A3B8", textAlign: "center", lineHeight: 20 },
  authRequiredButton: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
  },
  authRequiredButtonText: { color: "#111", fontSize: 14, fontWeight: "900" },

  singleCard: {
    width: "100%",
    alignSelf: "stretch",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
    marginBottom: 10,
  },
  bankResultRow: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1B2538",
    backgroundColor: "#111827",
  },
  bankEmptyRow: {
    alignItems: "flex-start",
  },
  singleCardActive: {
    borderColor: "#2563eb",
    backgroundColor: "#0f1a39",
  },

  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  bankCardContent: { flex: 1, minWidth: 0 },
  telText: { color: "#fff", fontWeight: "950" as any, fontSize: 18 },
  subText: { color: "#98a2b3", marginTop: 4 },
  linkedPostsText: { color: "#93c5fd", fontSize: 11, fontWeight: "800", marginTop: 6 },
  metaBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  miniMetaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0b1020",
  },
  miniMetaBadgeDanger: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  miniMetaBadgeWarn: { backgroundColor: "#facc15", borderColor: "#facc15" },
  miniMetaBadgeText: { color: "#c7d2fe", fontWeight: "900", fontSize: 11 },
  miniMetaBadgeTextDark: { color: "#111", fontWeight: "900", fontSize: 11 },

  bankActionColumn: { alignItems: "flex-end", gap: 8, marginLeft: 4 },

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
  bankActionIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bankIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  bankIconButtonNeutral: {
    backgroundColor: "#161f31",
    borderColor: "#2a3448",
  },
  bankIconButtonWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderColor: "rgba(245, 158, 11, 0.22)",
  },
  bankIconButtonDisabled: { opacity: 0.65 },
  bankIconButtonPressed: { opacity: 0.85 },
});

// =======================
// Search Styles (In-Content Search + Dropdown History Panel)
// =======================
const searchStyles = StyleSheet.create({
  // Positioning wrapper for search bar + dropdown
  searchAreaWrapper: {
    position: "relative",
    zIndex: 100,
    elevation: 12,
    marginBottom: 12,  // Spacing between search area and content below
  },

  // Wrapper for search bar when rendered in screen content (not header)
  // Note: paddingTop is applied dynamically with safe area insets to prevent status bar overlap
  inContentSearchWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "#0b0f19",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },

  searchRow: {
    minHeight: 44,
    justifyContent: "center",
  },

  // Search container (no longer needs flex:1 since it's not in header)
  headerSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    minHeight: 42,
    paddingRight: 4,
  },

  // Search input wrapper (takes remaining space)
  searchInputWrapper: {
    flex: 1,
    minWidth: 0,
  },

  // Header history button (inline, inside the search container)
  headerHistoryBtnInline: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    flexShrink: 0,
  },

  // Dropdown backdrop
  dropdownBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: 998,
  },

  // Dropdown panel (below in-content search bar)
  // Positioned absolutely relative to searchAreaWrapper
  dropdownPanel: {
    position: "absolute",
    top: "100%",  // Position directly below the search wrapper
    left: 16,  // Align with search bar horizontal padding
    right: 16,  // Align with search bar horizontal padding
    backgroundColor: "#0f1419",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    zIndex: 999,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  // Dropdown header
  dropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },

  dropdownTitle: {
    flex: 1,
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "700",
  },

  dropdownClearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  dropdownClearText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "700",
  },

  dropdownEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
  },

  // History item
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },

  historyItemText: {
    flex: 1,
    color: "#d1d5db",
    fontSize: 15,
    fontWeight: "500",
  },
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
  btnSecondary: { backgroundColor: "#0b1020", borderWidth: 1, borderColor: "#27335f" },

  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimaryText: { fontSize: 13, fontWeight: "900", color: "#111" },
  btnSecondaryText: { fontSize: 13, fontWeight: "900", color: "#fbbf24" },

  hint: { marginTop: 10, color: "#6b7280", fontSize: 11, lineHeight: 15 },
});

// =======================
// Styles (Top tabs)
// =======================
const topTabs = StyleSheet.create({
  wrap: { marginBottom: 12, alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
    padding: 2,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    minHeight: 36,
    flexShrink: 1,
  },
  btnOn: { backgroundColor: "#E2E8F0" },
  text: { color: "#CBD5E1", fontWeight: "800", fontSize: 13 },
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