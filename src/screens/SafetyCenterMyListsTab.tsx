// src/screens/SafetyCenterMyListsTab.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SectionList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  Platform,
  NativeModules,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import Clipboard from "@react-native-clipboard/clipboard";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { loadBlockedLogs, type BlockedLog } from "../lib/db-blocked-logs";
import { useNativeBlockDebugData, type NativeBlockDebugItem } from "../hooks/useNativeBlockDebugData";
import { Q_MY_BLOCKED_PHONE_KEYS } from "../hooks/useJachoeiStatusKeys";
import { toastGenericError, toastSuccess, toastTelReportRemoved } from "../lib/toast";
import {
  debugLookupNumber,
  exportDbDebug,
  inspectDb as inspectNativeDb,
  type DbInspectorPayload,
  type DbInspectorTableWithCount,
  type NativeLookupDebugResult,
  unblockNativeNumber,
} from "../native/CallBlocker";
import { useHiddenDiagnosticsMode } from "../lib/hiddenDiagnostics";

// ======================================================
// GraphQL
// ======================================================
const MY_BLOCKED_PHONES = gql`
  query MyBlockedPhones($limit: Int!, $offset: Int!) {
    myBlockedPhones(limit: $limit, offset: $offset) {
       phone
      phone_normalized

      my_blocked
      my_blocked_at

      blocked_by_count
      last_blocked_at

      report_count
      last_report_at

      risk_level
      updated_at
    }
  }
`;

const UNBLOCK_PHONE = gql`
  mutation UnblockPhone($input: UnblockPhoneInput!) {
    unblockPhone(input: $input) {
      ok
      status {
        phone
        phone_normalized
        my_blocked
      }
    }
  }
`;

// ✅ แก้ syntax ให้ถูก
const MY_REPORTED_PHONES = gql`
  query MyReportedPhones($limit: Int!, $offset: Int!) {
    myReportedPhones(limit: $limit, offset: $offset) {
      phone
      created_at
      updated_at
      report_count
      risk_level
      tags
      category
      note
      post_id
    }
  }
`;

// ✅ แก้ syntax ให้ถูก
const MY_REPORTED_BANKS = gql`
  query MyReportedBankAccounts($limit: Int!, $offset: Int!) {
    myReportedBankAccounts(limit: $limit, offset: $offset) {
      account
      bank_name
      created_at
      updated_at
      report_count
      risk_level
      tags
      category
      note
      post_id
    }
  }
`;

// ======================================================
// Types
// ======================================================
type PhoneSafetyStatus = {
  phone: string;
  blocked_at?: string | null;
  report_count?: number | null;
  risk_level?: number | null;
  tags?: string[] | null;
  note?: string | null;
};

type ReportItem = {
  kind: "PHONE" | "BANK";
  phone?: string | null;
  account?: string | null;
  bank_name?: string | null;
  category?: string | null;
  note?: string | null;
  report_count?: number | null;
  risk_level?: number | null;
  tags?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  post_id?: string | null;
};

type RiskFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";
type SortMode = "LATEST" | "RISK" | "REPORTS";

// ======================================================
// Utils
// ======================================================
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeRiskLabel(reportCount?: number | null, riskScore?: number | null) {
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

function fmtTime(v?: string | null) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
}

function formatTimestamp(ts?: number | string | null): string {
  if (!ts) return "-";

  try {
    let ms: number | null = null;

    if (typeof ts === "number") {
      if (!Number.isFinite(ts)) return "-";
      ms = ts < 1e12 ? ts * 1000 : ts;
    } else {
      const s = String(ts).trim();
      if (!s) return "-";

      // numeric string? (seconds or milliseconds)
      if (/^\d+$/.test(s)) {
        const num = parseInt(s, 10);
        if (!Number.isFinite(num)) return "-";
        ms = num < 1e12 ? num * 1000 : num;
      } else {
        // ISO-ish string or other date string
        const parsed = Date.parse(s);
        if (!Number.isFinite(parsed)) return "-";
        ms = parsed;
      }
    }

    if (ms == null || !Number.isFinite(ms)) return "-";
    const date = new Date(ms);
    if (isNaN(date.getTime())) return "-";

    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "-";
  }
}

function safeKey(s: string) {
  return String(s || "").replace(/\s+/g, "_");
}

function toJsonText(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch (e: any) {
    return String(e?.message || v);
  }
}

// ======================================================
// UI bits
// ======================================================
function Pill(props: { label: string; active?: boolean; onPress: () => void; icon?: string }) {
  const { label, active, onPress, icon } = props;
  return (
    <Pressable onPress={onPress} style={[st.pill, active && st.pillOn]}>
      {icon ? <Ionicons name={icon as any} size={14} color={active ? "#111" : "#cbd5e1"} /> : null}
      <Text style={[st.pillText, active && { color: "#111" }]}>{label}</Text>
    </Pressable>
  );
}

function SegmentedTabs(props: { value: string; onChange: (v: string) => void; items: { key: string; label: string; icon: string }[] }) {
  const { value, onChange, items } = props;
  return (
    <View style={st.segmentWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.segmentScroll}>
        <View style={st.segmentPill}>
          {items.map((it) => {
            const on = value === it.key;
            return (
              <Pressable
                key={it.key}
                onPress={() => onChange(it.key)}
                style={[st.segmentBtn, on && st.segmentBtnOn]}
              >
                <Ionicons name={it.icon as any} size={15} color={on ? "#111" : "#cbd5e1"} />
                <Text numberOfLines={1} style={[st.segmentText, on && { color: "#111" }]}>
                  {it.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ======================================================
// Screen
// ======================================================
export default function SafetyCenterMyListsTab() {
  const hiddenDiag = useHiddenDiagnosticsMode();

  // Hidden toggle: 7 taps within window
  const tapCountRef = useRef(0);
  const tapStartRef = useRef(0);
  const tapTimerRef = useRef<any>(null);
  const TAP_TARGET = 7;
  const TAP_WINDOW_MS = 5000;

  const resetTapState = useCallback(() => {
    tapCountRef.current = 0;
    tapStartRef.current = 0;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
  }, []);

  const onTitleTap = useCallback(() => {
    const now = Date.now();

    const start = tapStartRef.current;
    if (!start || now - start > TAP_WINDOW_MS) {
      resetTapState();
      tapStartRef.current = now;
      tapTimerRef.current = setTimeout(() => {
        resetTapState();
      }, TAP_WINDOW_MS);
    }

    tapCountRef.current += 1;

    const n = tapCountRef.current;
    // Temporary testing feedback: show tap progress in debug builds
    // (and also when diagnostics is already enabled).
    try {
      console.log(`[HiddenDiag] title tap ${n}/${TAP_TARGET}`);
    } catch {
      // ignore
    }
    if (__DEV__ || hiddenDiag.enabled) {
      toastSuccess(`Tap ${n}/${TAP_TARGET}`);
    }

    if (tapCountRef.current >= TAP_TARGET) {
      resetTapState();

      const next = !hiddenDiag.enabled;
      void (async () => {
        await hiddenDiag.setEnabled(next);
        toastSuccess(next ? "Diagnostics enabled" : "Diagnostics disabled");
      })();
    }
  }, [hiddenDiag.enabled, hiddenDiag.setEnabled, resetTapState]);

  useEffect(() => {
    return () => {
      resetTapState();
    };
  }, [resetTapState]);
  const LIMIT_BLOCKED = 50;
  const LIMIT_REPORTS = 80;
  const LIMIT_HISTORY = 120;

  const [tab, setTab] = useState<"BLOCKED" | "NATIVE_BLOCKED" | "REPORTS" | "HISTORY">("BLOCKED");

  const [q, setQ] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("LATEST");

  // BLOCKED
  const [blocked, setBlocked] = useState<PhoneSafetyStatus[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(true);
  const [blockedRefreshing, setBlockedRefreshing] = useState(false);
  const [blockedOffset, setBlockedOffset] = useState(0);
  const [blockedHasMore, setBlockedHasMore] = useState(true);
  const blockedInflight = useRef(false);

  // REPORTS
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsRefreshing, setReportsRefreshing] = useState(false);
  const [reportType, setReportType] = useState<"ALL" | "PHONE" | "BANK">("ALL");
  const reportsInflight = useRef(false);

  // HISTORY (local SQLite blocked_logs)
  const [history, setHistory] = useState<BlockedLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const historyInflight = useRef(false);
  const [historyFilter, setHistoryFilter] = useState<"ALL" | "BLOCKED" | "SPAM">("ALL");

  const [nativeFilter, setNativeFilter] = useState<"ALL" | "LOCAL" | "GLOBAL" | "RAW">("ALL");
  const [nativeUnblockBusy, setNativeUnblockBusy] = useState<Record<string, boolean>>({});

  // DEBUG: Block from Native
  const native = useNativeBlockDebugData();
  const nativeAutoFetchedRef = useRef(false);

  // DEBUG: SQLite Inspector (debug-only)
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectPayload, setInspectPayload] = useState<DbInspectorPayload | null>(null);
  const [inspectTables, setInspectTables] = useState<DbInspectorTableWithCount[]>([]);
  const [inspectSelected, setInspectSelected] = useState<string>("");

  // DEBUG: Export DB dump (single JSON text)
  const [exportOpen, setExportOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string>("");

  // DEBUG: Native lookup (exact call-screening path)
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupInput, setLookupInput] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<NativeLookupDebugResult | null>(null);

  const unblockDiagLoggedRef = useRef<Record<string, true>>({});

  function normalizeLocalBlockedFlag(v: any): { isLocalBlocked: boolean; raw: any; type: string } {
    const t = typeof v;
    if (t === "boolean") return { isLocalBlocked: v === true, raw: v, type: "boolean" };
    if (t === "number") return { isLocalBlocked: v === 1, raw: v, type: "number" };
    if (t === "string") {
      const s = v.trim().toLowerCase();
      if (s === "1" || s === "true") return { isLocalBlocked: true, raw: v, type: "string" };
      if (s === "0" || s === "-1" || s === "false") return { isLocalBlocked: false, raw: v, type: "string" };
    }
    return { isLocalBlocked: false, raw: v, type: t };
  }

  function recordUiDiagOnce(key: string, msg: string, data: Record<string, any>) {
    if (!(__DEV__ || hiddenDiag.enabled)) return;
    if (unblockDiagLoggedRef.current[key]) return;
    unblockDiagLoggedRef.current[key] = true;
    try {
      const mod: any = (NativeModules as any)?.CallBlocker;
      if (mod?.recordReleaseDiagnostic) {
        void mod.recordReleaseDiagnostic("NATIVE_UNBLOCK_UI", msg, data);
      }
    } catch {
      // ignore
    }
  }

  const openInspectDb = useCallback(async () => {
    if (!hiddenDiag.enabled) return;
    setInspectOpen(true);
    setInspectSelected("");
    setInspectError(null);
    setInspectLoading(true);

    try {
      const res = await inspectNativeDb(null);
      setInspectPayload(res);
      setInspectTables(Array.isArray(res?.tablesWithCounts) ? res.tablesWithCounts : []);
      setInspectError(res?.error ? String(res.error) : null);
    } catch (e: any) {
      setInspectError(e?.message || String(e));
      setInspectPayload(null);
      setInspectTables([]);
    } finally {
      setInspectLoading(false);
    }
  }, [hiddenDiag.enabled]);

  const closeInspectDb = useCallback(() => {
    setInspectOpen(false);
  }, []);

  const selectInspectTable = useCallback(async (name: string) => {
    if (!hiddenDiag.enabled) return;
    const table = String(name || "").trim();
    if (!table) return;

    setInspectSelected(table);
    setInspectError(null);
    setInspectLoading(true);

    try {
      const res = await inspectNativeDb(table);
      setInspectPayload(res);
      setInspectTables(Array.isArray(res?.tablesWithCounts) ? res.tablesWithCounts : []);
      setInspectError(res?.error ? String(res.error) : null);
    } catch (e: any) {
      setInspectError(e?.message || String(e));
    } finally {
      setInspectLoading(false);
    }
  }, [hiddenDiag.enabled]);

  const copyText = useCallback((label: string, text: string) => {
    try {
      Clipboard.setString(String(text || ""));
      Alert.alert("Copied", label);
    } catch (e: any) {
      Alert.alert("Copy failed", e?.message || String(e));
    }
  }, []);

  const openExportDbDebug = useCallback(async () => {
    if (!hiddenDiag.enabled) return;
    setExportOpen(true);
    setExportError(null);
    setExportLoading(true);
    setExportText("");

    try {
      const text = await exportDbDebug();
      setExportText(String(text || ""));
    } catch (e: any) {
      setExportError(e?.message || String(e));
      setExportText("");
    } finally {
      setExportLoading(false);
    }
  }, [hiddenDiag.enabled]);

  const closeExportDbDebug = useCallback(() => {
    setExportOpen(false);
  }, []);

  const openLookupDebug = useCallback(() => {
    if (!hiddenDiag.enabled) return;
    setLookupOpen(true);
    setLookupError(null);
    setLookupResult(null);
    setLookupInput("");
  }, [hiddenDiag.enabled]);

  const closeLookupDebug = useCallback(() => {
    setLookupOpen(false);
  }, []);

  const runLookupDebug = useCallback(async () => {
    if (!hiddenDiag.enabled) return;
    const raw = String(lookupInput || "").trim();
    if (!raw) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const res = await debugLookupNumber(raw);
      setLookupResult(res);
      setLookupError(res?.error ? String(res.error) : null);
    } catch (e: any) {
      setLookupError(e?.message || String(e));
      setLookupResult(null);
    } finally {
      setLookupLoading(false);
    }
  }, [hiddenDiag.enabled, lookupInput]);

  // -----------------------
  // fetch blocked (paged)
  // -----------------------
  const fetchBlockedPage = useCallback(async (nextOffset: number, mode: "replace" | "append") => {
    if (blockedInflight.current) return;
    blockedInflight.current = true;
    try {
      const res = await client.query<{ myBlockedPhones: PhoneSafetyStatus[] }>({
        query: MY_BLOCKED_PHONES,
        variables: { limit: LIMIT_BLOCKED, offset: nextOffset },
        fetchPolicy: "network-only",
      });

      const list = res.data?.myBlockedPhones ?? [];
      setBlockedHasMore(list.length >= LIMIT_BLOCKED);
      setBlockedOffset(nextOffset);

      setBlocked((prev) => {
        const merged = mode === "replace" ? list : [...prev, ...list];
        const seen: Record<string, true> = {};
        const out: PhoneSafetyStatus[] = [];
        for (const it of merged) {
          const k = normalizeTel(it.phone) || it.phone;
          if (seen[k]) continue;
          seen[k] = true;
          out.push(it);
        }
        return out;
      });
    } catch (e: any) {
      Alert.alert("โหลดรายการบล็อกไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
    } finally {
      blockedInflight.current = false;
    }
  }, []);

  const loadBlockedInitial = useCallback(async () => {
    setBlockedLoading(true);
    await fetchBlockedPage(0, "replace");
    setBlockedLoading(false);
  }, [fetchBlockedPage]);

  const refreshBlocked = useCallback(async () => {
    setBlockedRefreshing(true);
    await fetchBlockedPage(0, "replace");
    setBlockedRefreshing(false);
  }, [fetchBlockedPage]);

  const loadMoreBlocked = useCallback(async () => {
    if (!blockedHasMore || blockedInflight.current) return;
    await fetchBlockedPage(blockedOffset + LIMIT_BLOCKED, "append");
  }, [blockedHasMore, blockedOffset, fetchBlockedPage]);

  // -----------------------
  // fetch reports (merge)
  // -----------------------
  const loadReports = useCallback(async () => {
    if (reportsInflight.current) return;
    reportsInflight.current = true;

    try {
      const [pRes, bRes] = await Promise.all([
        client.query<any>({
          query: MY_REPORTED_PHONES,
          variables: { limit: LIMIT_REPORTS, offset: 0 },
          fetchPolicy: "network-only",
        }),
        client.query<any>({
          query: MY_REPORTED_BANKS,
          variables: { limit: LIMIT_REPORTS, offset: 0 },
          fetchPolicy: "network-only",
        }),
      ]);

      const phonesRaw = (pRes.data?.myReportedPhones ?? []) as any[];
      const banksRaw  = (bRes.data?.myReportedBankAccounts ?? []) as any[];

      const phoneItems: ReportItem[] = phonesRaw.map((x) => ({
        kind: "PHONE",
        phone: x.phone ?? null,
        category: x.category ?? null,
        note: x.note ?? null,
        report_count: x.report_count ?? null,
        risk_level: x.risk_level ?? null,
        tags: x.tags ?? null,
        created_at: x.created_at ?? null,
        updated_at: x.updated_at ?? null,
        post_id: x.post_id ?? null,
      }));

      const bankItems: ReportItem[] = banksRaw.map((x) => ({
        kind: "BANK",
        account: x.account ?? null,
        bank_name: x.bank_name ?? null,
        category: x.category ?? null,
        note: x.note ?? null,
        report_count: x.report_count ?? null,
        risk_level: x.risk_level ?? null,
        tags: x.tags ?? null,
        created_at: x.created_at ?? null,
        updated_at: x.updated_at ?? null,
        post_id: x.post_id ?? null,
      }));

      const merged = [...phoneItems, ...bankItems];

      const seen: Record<string, true> = {};
      const out: ReportItem[] = [];
      for (const it of merged) {
        const key =
          it.kind === "PHONE"
            ? `P:${normalizeTel(it.phone || "") || it.phone || ""}:${it.post_id || ""}:${it.created_at || it.updated_at || ""}`
            : `B:${normalizeBankAccount(it.account || "") || it.account || ""}:${it.bank_name || ""}:${it.post_id || ""}:${it.created_at || it.updated_at || ""}`;

        if (!key || seen[key]) continue;
        seen[key] = true;
        out.push(it);
      }

      setReports(out);
    } catch (e: any) {
      Alert.alert("โหลดรายการรายงานไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
    } finally {
      reportsInflight.current = false;
    }
  }, []);

  const loadReportsInitial = useCallback(async () => {
    setReportsLoading(true);
    await loadReports();
    setReportsLoading(false);
  }, [loadReports]);

  const refreshReports = useCallback(async () => {
    setReportsRefreshing(true);
    await loadReports();
    setReportsRefreshing(false);
  }, [loadReports]);

  // -----------------------
  // fetch history (local SQLite blocked_logs)
  // -----------------------
  const fetchHistoryPage = useCallback(async (nextOffset: number, mode: "replace" | "append") => {
    if (historyInflight.current) return;
    historyInflight.current = true;

    try {
      const list = await loadBlockedLogs({ limit: LIMIT_HISTORY, offset: nextOffset });
      setHistoryHasMore(list.length >= LIMIT_HISTORY);
      setHistoryOffset(nextOffset);
      setHistory((prev) => (mode === "replace" ? list : [...prev, ...list]));
    } catch {
      // local-only: ignore
    } finally {
      historyInflight.current = false;
    }
  }, []);

  const loadHistoryInitial = useCallback(async () => {
    setHistoryLoading(true);
    await fetchHistoryPage(0, "replace");
    setHistoryLoading(false);
  }, [fetchHistoryPage]);

  const refreshHistory = useCallback(async () => {
    setHistoryRefreshing(true);
    await fetchHistoryPage(0, "replace");
    setHistoryRefreshing(false);
  }, [fetchHistoryPage]);

  const loadMoreHistory = useCallback(async () => {
    if (!historyHasMore || historyInflight.current) return;
    await fetchHistoryPage(historyOffset + LIMIT_HISTORY, "append");
  }, [historyHasMore, historyOffset, fetchHistoryPage]);

  useEffect(() => {
    loadBlockedInitial();
    loadReportsInitial();
  }, [loadBlockedInitial, loadReportsInitial]);

  useEffect(() => {
    if (tab !== "HISTORY") return;
    if (history.length > 0 || historyInflight.current) return;
    void loadHistoryInitial();
  }, [history.length, loadHistoryInitial, tab]);

  useEffect(() => {
    if (tab !== "NATIVE_BLOCKED") {
      nativeAutoFetchedRef.current = false;
      return;
    }
    if (nativeAutoFetchedRef.current) return;
    nativeAutoFetchedRef.current = true;
    void native.fetchData();
  }, [tab, native.fetchData]);

  // ---------------------------------
  // Unblock
  // ---------------------------------

  async function unblockTelOnServer(phone: string) {
    const input = { phone };
    const res = await client.mutate<{ unblockPhone: { ok: boolean } }>({
      mutation: UNBLOCK_PHONE,
      variables: { input },
      refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
      awaitRefetchQueries: true,
    });
    return res.data?.unblockPhone;
  }

  const unblock = useCallback(async (phone: string) => {
    const tel = normalizeTel(phone) || phone;
    Alert.alert("Unblock เบอร์นี้?", tel, [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "Unblock",
        style: "destructive",
        onPress: async () => {
          try {
            const payload = await unblockTelOnServer(tel);
            const ok = payload?.ok;
            if (!ok) throw new Error("Unblock failed");

            setBlocked((prev) => prev.filter((x) => (normalizeTel(x.phone) || x.phone) !== tel));
          } catch (e: any) {
            Alert.alert("Unblock ไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
          }
        },
      },
    ]);
  }, []);

  // ---------------------------------
  // Derived lists (filter/sort)
  // ---------------------------------
  const blockedFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = blocked;

    if (term) list = list.filter((x) => (normalizeTel(x.phone) || x.phone).toLowerCase().includes(term));

    if (riskFilter !== "ALL") {
      list = list.filter((x) => {
        const riskScore = clamp(Number(x.risk_level || 0), 0, 100);
        const meta = computeRiskLabel(x.report_count ?? 0, riskScore);
        return meta.label === riskFilter;
      });
    }

    return [...list].sort((a, b) => {
      const ra = clamp(Number(a.risk_level || 0), 0, 100);
      const rb = clamp(Number(b.risk_level || 0), 0, 100);
      const ca = Number(a.report_count || 0);
      const cb = Number(b.report_count || 0);
      const ta = a.blocked_at ? new Date(a.blocked_at).getTime() : 0;
      const tb = b.blocked_at ? new Date(b.blocked_at).getTime() : 0;

      if (sortMode === "RISK") return rb - ra;
      if (sortMode === "REPORTS") return cb - ca;
      return tb - ta;
    });
  }, [blocked, q, riskFilter, sortMode]);

  const reportsFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = reports;

    if (reportType !== "ALL") list = list.filter((x) => x.kind === reportType);

    if (term) {
      list = list.filter((x) => {
        const phone = normalizeTel(x.phone || "") || x.phone || "";
        const acc = normalizeBankAccount(x.account || "") || x.account || "";
        const bank = String(x.bank_name || "");
        const cat = String(x.category || "");
        const note = String(x.note || "");
        return `${phone} ${acc} ${bank} ${cat} ${note}`.toLowerCase().includes(term);
      });
    }

    if (riskFilter !== "ALL") {
      list = list.filter((x) => {
        const riskScore = clamp(Number(x.risk_level || 0), 0, 100);
        const meta = computeRiskLabel(x.report_count ?? 0, riskScore);
        return meta.label === riskFilter;
      });
    }

    return [...list].sort((a, b) => {
      const ra = clamp(Number(a.risk_level || 0), 0, 100);
      const rb = clamp(Number(b.risk_level || 0), 0, 100);
      const ca = Number(a.report_count || 0);
      const cb = Number(b.report_count || 0);
      const ta = (a.updated_at || a.created_at) ? new Date(a.updated_at || a.created_at || "").getTime() : 0;
      const tb = (b.updated_at || b.created_at) ? new Date(b.updated_at || b.created_at || "").getTime() : 0;

      if (sortMode === "RISK") return rb - ra;
      if (sortMode === "REPORTS") return cb - ca;
      return tb - ta;
    });
  }, [reports, q, reportType, riskFilter, sortMode]);

  function parseHistoryDetail(detail: string | null | undefined): { action?: string; source?: string; note?: string } | null {
    if (!detail) return null;
    const s = String(detail);
    if (!s.trim()) return null;
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj !== "object") return null;
      return {
        action: typeof (obj as any).action === "string" ? (obj as any).action : undefined,
        source: typeof (obj as any).source === "string" ? (obj as any).source : undefined,
        note: typeof (obj as any).note === "string" ? (obj as any).note : undefined,
      };
    } catch {
      return null;
    }
  }

  const historyFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();

    let list = history;
    if (term) {
      list = list.filter((x) => {
        const meta = parseHistoryDetail(x.detail);
        const note = meta?.note ? String(meta.note) : "";
        return `${x.phone_normalized || ""} ${x.raw_phone || ""} ${x.type || ""} ${note}`.toLowerCase().includes(term);
      });
    }

    if (historyFilter !== "ALL") {
      list = list.filter((x) => {
        const meta = parseHistoryDetail(x.detail);
        const action = String(meta?.action || "");
        if (historyFilter === "BLOCKED") return action === "blocked_call";
        if (historyFilter === "SPAM") return action === "spam_warning";
        return true;
      });
    }

    return list;
  }, [history, historyFilter, q]);

  const summaryText = useMemo(() => {
    if (tab === "BLOCKED") return `${blockedFiltered.length} รายการ`;
    if (tab === "REPORTS") return `${reportsFiltered.length} รายการ`;
    if (tab === "NATIVE_BLOCKED") {
      const rawCount = typeof native.data.rawCountBeforeFilter === "number" ? native.data.rawCountBeforeFilter : 0;
      return `${rawCount} รายการ`;
    }
    return `${historyFiltered.length} รายการ`;
  }, [tab, blockedFiltered.length, historyFiltered.length, native.data.rawCountBeforeFilter, reportsFiltered.length]);

  const nativeSections = useMemo(() => {
    const term = q.trim().toLowerCase();

    function matchRow(x: NativeBlockDebugItem) {
      if (!term) return true;
      const phone = String(x.phone || "");
      const tags = typeof x.tags === "string" ? x.tags : "";
      const id = typeof (x as any)?.id === "number" ? String((x as any).id) : "";
      return `${id} ${phone} ${tags}`.toLowerCase().includes(term);
    }

    const local = (Array.isArray(native.data.local) ? native.data.local : []).filter(matchRow);
    const global = (Array.isArray(native.data.global) ? native.data.global : []).filter(matchRow);
    const raw = (Array.isArray((native.data as any).rawRows) ? (native.data as any).rawRows : []).filter(matchRow);

    const sections: { key: "LOCAL" | "GLOBAL" | "RAW"; title: string; desc: string; data: NativeBlockDebugItem[] }[] = [];
    if (nativeFilter === "RAW") {
      sections.push({
        key: "RAW",
        title: "Raw",
        desc: "no classification / direct scam_phones rows",
        data: raw,
      });
      return sections;
    }

    if (nativeFilter === "ALL" || nativeFilter === "LOCAL") {
      sections.push({
        key: "LOCAL",
        title: "Local",
        desc: "blocked on this device / by user",
        data: local,
      });
    }
    if (nativeFilter === "ALL" || nativeFilter === "GLOBAL") {
      sections.push({
        key: "GLOBAL",
        title: "Global",
        desc: "synced/community/server records",
        data: global,
      });
    }
    return sections;
  }, [native.data.global, native.data.local, (native.data as any).rawRows, nativeFilter, q]);

  useEffect(() => {
    if (tab !== "NATIVE_BLOCKED") return;
    if (!(__DEV__ || hiddenDiag.enabled)) return;

    for (const s of nativeSections as any) {
      const sKey = String((s as any)?.key || "");
      const rows: any[] = Array.isArray((s as any)?.data) ? (s as any).data : [];
      for (const item of rows) {
        const phone = String(item?.phone || "");

        const localRawCandidate = (item as any)?.localBlockedRaw;
        const localFlagCandidate = typeof localRawCandidate !== "undefined" ? localRawCandidate : (item as any)?.localBlocked;
        const norm = normalizeLocalBlockedFlag(localFlagCandidate);

        const isRaw = sKey === "RAW";
        const isLocalBadge = sKey === "LOCAL" || norm.isLocalBlocked;
        const showUnblock = Platform.OS === "android" && !isRaw && isLocalBadge;

        const key = `${tab}:${nativeFilter}:${sKey}:${phone}`;
        recordUiDiagOnce(key, "native unblock render check", {
          tab,
          nativeFilter,
          sectionKey: sKey,
          phone,
          localBlockedRaw: norm.raw,
          localBlockedType: norm.type,
          localBlockedNormalized: norm.isLocalBlocked,
          showUnblock,
          __DEV__,
          platform: Platform.OS,
        });

        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log("[NATIVE_UNBLOCK_UI]", {
            tab,
            nativeFilter,
            sKey,
            phone,
            localBlockedRaw: norm.raw,
            localBlockedType: norm.type,
            localBlockedNormalized: norm.isLocalBlocked,
            showUnblock,
          });
        }
      }
    }
  }, [hiddenDiag.enabled, nativeFilter, nativeSections, tab]);

  return (
    <View style={st.container}>
      <SegmentedTabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        items={[
          { key: "BLOCKED", label: "Blocked", icon: "lock-closed-outline" },
          { key: "NATIVE_BLOCKED", label: "DB Local", icon: "server-outline" },
          { key: "REPORTS", label: "Reports", icon: "megaphone-outline" },
          { key: "HISTORY", label: "History", icon: "time-outline" },
        ]}
      />

      <View style={st.headerBlock}>
        <Pressable onPress={onTitleTap} hitSlop={16}>
          <Text style={st.hTitle}>
            {tab === "BLOCKED"
              ? "Blocked (เบอร์ที่บล็อก)"
              : tab === "NATIVE_BLOCKED"
              ? "Native"
              : tab === "REPORTS"
              ? "Reports (ที่รายงานไป)"
              : "History (Call/SMS events)"}
          </Text>
        </Pressable>
        <Text style={st.hSub}>{summaryText}</Text>
      </View>

      <View style={st.searchRow}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={
            tab === "BLOCKED"
              ? "ค้นหาเบอร์ที่บล็อก..."
              : tab === "REPORTS"
              ? "ค้นหา phone / bank / note ..."
              : "ค้นหา phone / detail ..."
          }
          placeholderTextColor="#6b7280"
          style={st.searchInput}
          returnKeyType="search"
        />
        {!!q && (
          <Pressable onPress={() => setQ("")} hitSlop={10} style={st.clearBtn}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </Pressable>
        )}
      </View>

      {tab === "BLOCKED" || tab === "REPORTS" ? (
        <>
          <View style={st.filterRow}>
            <Pill label="ALL" active={riskFilter === "ALL"} onPress={() => setRiskFilter("ALL")} />
            <Pill label="HIGH" active={riskFilter === "HIGH"} onPress={() => setRiskFilter("HIGH")} />
            <Pill label="MEDIUM" active={riskFilter === "MEDIUM"} onPress={() => setRiskFilter("MEDIUM")} />
            <Pill label="LOW" active={riskFilter === "LOW"} onPress={() => setRiskFilter("LOW")} />
          </View>

          <View style={st.filterRow}>
            <Pill label="Latest" active={sortMode === "LATEST"} onPress={() => setSortMode("LATEST")} icon="time-outline" />
            <Pill label="Risk" active={sortMode === "RISK"} onPress={() => setSortMode("RISK")} icon="warning-outline" />
            <Pill label="Reports" active={sortMode === "REPORTS"} onPress={() => setSortMode("REPORTS")} icon="stats-chart-outline" />
          </View>
        </>
      ) : tab === "HISTORY" ? (
        <View style={st.filterRow}>
          <Pill label="ALL" active={historyFilter === "ALL"} onPress={() => setHistoryFilter("ALL")} />
          <Pill label="BLOCKED" active={historyFilter === "BLOCKED"} onPress={() => setHistoryFilter("BLOCKED")} icon="lock-closed-outline" />
          <Pill label="SPAM" active={historyFilter === "SPAM"} onPress={() => setHistoryFilter("SPAM")} icon="warning-outline" />
        </View>
      ) : (
        <View style={st.filterRow}>
          <Pill label="ALL" active={nativeFilter === "ALL"} onPress={() => setNativeFilter("ALL")} />
          <Pill label="Local" active={nativeFilter === "LOCAL"} onPress={() => setNativeFilter("LOCAL")} icon="lock-closed-outline" />
          <Pill label="Global" active={nativeFilter === "GLOBAL"} onPress={() => setNativeFilter("GLOBAL")} icon="warning-outline" />
          <Pill label="Raw" active={nativeFilter === "RAW"} onPress={() => setNativeFilter("RAW")} icon="list-outline" />
        </View>
      )}

      {tab === "REPORTS" ? (
        <View style={[st.filterRow, { marginTop: 8 }]}>
          <Pill label="ALL" active={reportType === "ALL"} onPress={() => setReportType("ALL")} />
          <Pill label="PHONE" active={reportType === "PHONE"} onPress={() => setReportType("PHONE")} icon="call-outline" />
          <Pill label="BANK" active={reportType === "BANK"} onPress={() => setReportType("BANK")} icon="card-outline" />
        </View>
      ) : null}

      {tab === "NATIVE_BLOCKED" ? (
        <SectionList
          sections={nativeSections as any}
          keyExtractor={(item, idx) => `${String((item as any)?.phone || "-")}#${idx}`}
          refreshControl={<RefreshControl refreshing={native.loading} onRefresh={native.fetchData} tintColor="#fff" />}
          contentContainerStyle={{ paddingBottom: 18 }}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={st.card}>
              <View style={st.nativeHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.nativeTitle}>Block from Native</Text>

                  <View style={st.nativeMeta}>
                    <Text style={st.nativeCountsLine}>
                      total: {native.data.rawCountBeforeFilter} • local: {native.data.localCount} • global: {native.data.globalCount}
                    </Text>
                    {(native.data.localCount > native.data.local.length || native.data.globalCount > native.data.global.length) && (
                      <Text style={st.nativeMetaLine}>
                        Showing {native.data.local.length}/{native.data.localCount} local and {native.data.global.length}/{native.data.globalCount} global (capped)
                      </Text>
                    )}

                    {hiddenDiag.enabled ? (
                      <>
                        <Text style={st.nativeMetaLine}>DB name: {native.data.dbName || "scam-protect.db"}</Text>
                        {!!native.data.packageName && <Text style={st.nativeMetaLine}>package: {native.data.packageName}</Text>}
                        <Text style={st.nativeMetaLine}>DB path: {native.data.dbPath || "(unknown)"}</Text>
                        {typeof native.data.fileExists === "boolean" ? (
                          <Text style={st.nativeMetaLine}>
                            file: {native.data.fileExists ? "exists" : "missing"}
                            {typeof native.data.fileSizeBytes === "number"
                              ? ` • size: ${Math.max(0, Math.round(native.data.fileSizeBytes))} bytes`
                              : ""}
                          </Text>
                        ) : null}
                        {!!native.data.pragmaMainPath && <Text style={st.nativeMetaLine}>sqlite main: {native.data.pragmaMainPath}</Text>}
                        {!!native.data.tableUsed && <Text style={st.nativeMetaLine}>table: {native.data.tableUsed}</Text>}
                        {!!native.data.debugError && <Text style={st.nativeError}>Debug: {native.data.debugError}</Text>}
                        {!!native.data.debugWarnings?.length && <Text style={st.nativeError}>warnings: {native.data.debugWarnings.length}</Text>}
                        {typeof (native.data as any).rawTableCount === "number" ? (
                          <Text style={st.nativeMetaLine}>rawTableCount: {(native.data as any).rawTableCount}</Text>
                        ) : null}

                        {native.data.sampleRows?.length ? (
                          <Text style={st.nativeMetaLine}>
                            sample: {String(native.data.sampleRows[0]?.phone || "-")}
                            {typeof native.data.sampleRows[0]?.riskLevel === "number" ? ` • risk: ${native.data.sampleRows[0].riskLevel}` : ""}
                            {typeof native.data.sampleRows[0]?.serverDeleted === "number" ? ` • del: ${native.data.sampleRows[0].serverDeleted}` : ""}
                          </Text>
                        ) : null}

                        {!!native.data.lastWriteAction && (
                          <Text style={st.nativeMetaLine}>
                            last write: {native.data.lastWriteAction}
                            {native.data.lastWriteRowsAffected ? ` • rows: ${native.data.lastWriteRowsAffected}` : ""}
                          </Text>
                        )}
                        {!!native.data.lastWriteError && <Text style={st.nativeError}>last write error: {native.data.lastWriteError}</Text>}

                        {!!native.data.writeTableName && (
                          <Text style={st.nativeMetaLine}>
                            write: {native.data.writeTableName}
                            {native.data.transactionCommitted ? " • committed" : " • NOT committed"}
                            {native.data.insertResultRowId ? ` • rowId: ${native.data.insertResultRowId}` : ""}
                            {typeof native.data.countFromWriteTableAfterWrite === "number"
                              ? ` • countAfter: ${native.data.countFromWriteTableAfterWrite}`
                              : ""}
                          </Text>
                        )}
                        {!!native.data.phone_normalized && (
                          <Text style={st.nativeMetaLine}>
                            phone: {native.data.phone_normalized}
                            {native.data.didUpdate ? " • didUpdate" : ""}
                            {native.data.didInsert ? " • didInsert" : ""}
                          </Text>
                        )}
                        {!!native.data.writeDbPath && <Text style={st.nativeMetaLine}>write path: {native.data.writeDbPath}</Text>}
                        {!!native.data.writeSql && <Text style={st.nativeMetaLine}>write sql: {native.data.writeSql}</Text>}
                        {!!native.data.writeArgs && <Text style={st.nativeMetaLine}>write args: {native.data.writeArgs}</Text>}
                        {!!native.data.sampleRowsFromWriteTableAfterWrite && (
                          <Text style={st.nativeMetaLine}>write sample: {native.data.sampleRowsFromWriteTableAfterWrite}</Text>
                        )}
                        {!!native.data.matchedRowAfterWrite && (
                          <Text style={st.nativeMetaLine}>matched row: {native.data.matchedRowAfterWrite}</Text>
                        )}
                      </>
                    ) : null}
                  </View>
                </View>

                <View style={st.nativeActionsCol}>
                  <Pressable
                    onPress={native.fetchData}
                    disabled={native.loading}
                    style={[st.nativeRefreshBtn, native.loading && st.nativeRefreshBtnDisabled]}
                  >
                    {native.loading ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons name="refresh-outline" size={18} color="#e5e7eb" />
                    )}
                    <Text style={st.nativeRefreshText}>Refresh</Text>
                  </Pressable>

                  {hiddenDiag.enabled ? (
                    <Pressable
                      onPress={openInspectDb}
                      disabled={native.loading}
                      style={[st.nativeRefreshBtn, native.loading && st.nativeRefreshBtnDisabled]}
                    >
                      <Ionicons name="search-outline" size={18} color="#e5e7eb" />
                      <Text style={st.nativeRefreshText}>Inspect DB</Text>
                    </Pressable>
                  ) : null}

                  {hiddenDiag.enabled ? (
                    <Pressable
                      onPress={openExportDbDebug}
                      disabled={native.loading}
                      style={[st.nativeRefreshBtn, native.loading && st.nativeRefreshBtnDisabled]}
                    >
                      <Ionicons name="share-outline" size={18} color="#e5e7eb" />
                      <Text style={st.nativeRefreshText}>Export DB Debug</Text>
                    </Pressable>
                  ) : null}

                  {hiddenDiag.enabled ? (
                    <Pressable
                      onPress={openLookupDebug}
                      disabled={native.loading}
                      style={[st.nativeRefreshBtn, native.loading && st.nativeRefreshBtnDisabled]}
                    >
                      <Ionicons name="search-outline" size={18} color="#e5e7eb" />
                      <Text style={st.nativeRefreshText}>Lookup Number</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {!!native.error && <Text style={st.nativeError}>Error: {native.error}</Text>}
            </View>
          }
          ListEmptyComponent={
            native.loading ? (
              <View style={st.loadingBox}>
                <ActivityIndicator />
                <Text style={st.muted}>กำลังโหลด...</Text>
              </View>
            ) : (
              <View style={st.emptyBox}>
                <Text style={st.emptyTitle}>ยังไม่มีรายการ</Text>
                <Text style={st.muted}>ไม่พบข้อมูลใน DB หรือไม่มีแถวที่เข้าเงื่อนไข Local/Global</Text>
              </View>
            )
          }
          renderSectionHeader={({ section }) => {
            const key = (section as any)?.key as "LOCAL" | "GLOBAL";
            const tone = key === "LOCAL" ? st.nativeBadgeLocal : st.nativeBadgeSpam;
            const title = (section as any)?.title || (key === "LOCAL" ? "Local" : "Global");
            const desc = (section as any)?.desc || "";
            const count = Array.isArray((section as any)?.data) ? (section as any).data.length : 0;

            return (
              <View style={st.card}>
                <View style={st.nativeRowTop}>
                  <Text style={st.mainText}>{title}</Text>
                  <View style={[st.nativeBadge, tone]}>
                    <Text style={st.nativeBadgeText}>{count}</Text>
                  </View>
                </View>
                {!!desc && <Text style={st.muted}>{desc}</Text>}
              </View>
            );
          }}
          renderItem={({ item, section }) => {
            const sKey = ((section as any)?.key as "LOCAL" | "GLOBAL") || "GLOBAL";
            const phone = String((item as any)?.phone || "");
            const risk = Number((item as any)?.riskLevel || 0) || 0;
            const localRawCandidate = (item as any)?.localBlockedRaw;
            const localFlagCandidate = typeof localRawCandidate !== "undefined" ? localRawCandidate : (item as any)?.localBlocked;
            const localBlocked = normalizeLocalBlockedFlag(localFlagCandidate).isLocalBlocked;
            const serverDeleted = Number((item as any)?.serverDeleted || 0) || 0;
            const reportCount = (item as any)?.reportCount;
            const tags = (item as any)?.tags;
            const lastReportAt = (item as any)?.lastReportAt;

            const isRaw = (sKey as any) === "RAW";
            const badgeStyle = sKey === "LOCAL" || localBlocked ? st.nativeBadgeLocal : st.nativeBadgeSpam;
            const badgeLabel = isRaw ? "RAW" : sKey === "LOCAL" || localBlocked ? "LOCAL BLOCK" : "GLOBAL";

            const isLocalBadge = sKey === "LOCAL" || localBlocked;
            const showUnblock = Platform.OS === "android" && !isRaw && isLocalBadge;

            const busyKey = `${sKey}:${phone}`;
            const busy = !!nativeUnblockBusy[busyKey];

            const doUnblock = () => {
              if (!isLocalBadge) return;
              if (!phone) return;

              recordUiDiagOnce(
                `tap:${tab}:${nativeFilter}:${sKey}:${phone}`,
                "unblock tap",
                {
                  tab,
                  nativeFilter,
                  sectionKey: sKey,
                  phone,
                  showUnblock,
                  localBlocked,
                  localBlockedRaw: localFlagCandidate,
                  localBlockedType: typeof localFlagCandidate,
                  __DEV__,
                  platform: Platform.OS,
                }
              );

              Alert.alert("Unblock?", `Unblock ${phone} on server and locally?`, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Unblock",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      setNativeUnblockBusy((prev) => ({ ...prev, [busyKey]: true }));

                      // 1) Server unblock (reuse Home flow)
                      const tel = normalizeTel(phone) || phone;
                      const payload = await unblockTelOnServer(tel);
                      if (!payload?.ok) {
                        toastGenericError();
                        return;
                      }
                      toastTelReportRemoved();

                      // keep this screen's Blocked tab state consistent if present
                      setBlocked((prev) => prev.filter((x) => (normalizeTel(x.phone) || x.phone) !== tel));

                      // 2) Native SQLite unblock
                      const nativeRes = await unblockNativeNumber(tel);
                      if (!nativeRes?.ok) {
                        recordUiDiagOnce(
                          `tap:${tab}:${nativeFilter}:${sKey}:${phone}:native_not_ok`,
                          "unblock native not ok",
                          {
                            tab,
                            nativeFilter,
                            sectionKey: sKey,
                            phone,
                            tel,
                            nativeRes,
                          }
                        );
                        toastGenericError();
                        return;
                      }

                      recordUiDiagOnce(
                        `tap:${tab}:${nativeFilter}:${sKey}:${phone}:ok`,
                        "unblock OK",
                        {
                          tab,
                          nativeFilter,
                          sectionKey: sKey,
                          phone,
                          tel,
                          nativeRes,
                        }
                      );
                    } catch {
                      recordUiDiagOnce(
                        `tap:${tab}:${nativeFilter}:${sKey}:${phone}:error`,
                        "unblock ERROR",
                        {
                          tab,
                          nativeFilter,
                          sectionKey: sKey,
                          phone,
                        }
                      );
                      toastGenericError();
                    } finally {
                      setNativeUnblockBusy((prev) => {
                        const next = { ...prev };
                        delete next[busyKey];
                        return next;
                      });
                    }
                  },
                },
              ]);
            };

            return (
              <View style={st.card}>
                <View style={st.nativeRowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.mainText}>{phone || "-"}</Text>
                  </View>
                  <View style={st.nativeBadges}>
                    <View style={[st.nativeBadge, badgeStyle]}>
                      <Text style={st.nativeBadgeText}>{badgeLabel}</Text>
                    </View>
                    {serverDeleted === 1 ? (
                      <View style={st.nativeBadge}>
                        <Text style={st.nativeBadgeText}>DELETED</Text>
                      </View>
                    ) : null}

                    {showUnblock ? (
                      <Pressable
                        onPress={doUnblock}
                        disabled={busy}
                        style={[st.nativeUnblockBtn, busy && st.nativeRefreshBtnDisabled]}
                      >
                        {busy ? <ActivityIndicator size="small" /> : <Ionicons name="trash-outline" size={16} color="#111" />}
                        <Text style={st.nativeUnblockText}>Unblock</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {isRaw ? (
                  <Text style={[st.muted, st.nativeItemMeta]}>
                    id: {String((item as any)?.id ?? "-")}
                    {typeof (item as any)?.localBlockedRaw === "number" ? ` • local_blocked: ${(item as any).localBlockedRaw}` : ""}
                    {typeof (item as any)?.riskLevel === "number" ? ` • risk_level: ${(item as any).riskLevel}` : ""}
                    {typeof (item as any)?.reportCount === "number" ? ` • report_count: ${(item as any).reportCount}` : ""}
                    {typeof (item as any)?.serverDeleted === "number" ? ` • server_deleted: ${(item as any).serverDeleted}` : ""}
                    {(item as any)?.serverUpdatedAt ? ` • updated: ${String((item as any).serverUpdatedAt)}` : ""}
                  </Text>
                ) : (
                  <>
                    <Text style={[st.muted, st.nativeItemMeta]}>
                      Risk: {risk}
                      {typeof reportCount === "number" ? ` • reports: ${reportCount}` : ""}
                      {lastReportAt ? ` • last: ${formatTimestamp(lastReportAt as any)}` : ""}
                    </Text>
                    {!!tags && <Text style={[st.muted, st.nativeItemMeta]}>{`tags: ${String(tags)}`}</Text>}
                  </>
                )}
              </View>
            );
          }}
        />
      ) : tab === "BLOCKED" ? (
        blockedLoading ? (
          <View style={st.loadingBox}>
            <ActivityIndicator />
            <Text style={st.muted}>กำลังโหลด...</Text>
          </View>
        ) : (
          <FlatList
            data={blockedFiltered}
            keyExtractor={(it) => normalizeTel(it.phone) || it.phone}
            refreshControl={<RefreshControl refreshing={blockedRefreshing} onRefresh={refreshBlocked} tintColor="#fff" />}
            onEndReachedThreshold={0.4}
            onEndReached={loadMoreBlocked}
            contentContainerStyle={{ paddingBottom: 18 }}
            ListEmptyComponent={
              <View style={st.emptyBox}>
                <Text style={st.emptyTitle}>ยังไม่มีรายการ</Text>
                <Text style={st.muted}>เมื่อคุณบล็อกเบอร์ จะมาแสดงที่นี่</Text>
              </View>
            }
            ListFooterComponent={
              blockedHasMore ? (
                <View style={{ paddingVertical: 12 }}>
                  <ActivityIndicator />
                </View>
              ) : (
                <View style={{ paddingVertical: 12 }}>
                  <Text style={[st.muted, { textAlign: "center" }]}>จบรายการ</Text>
                </View>
              )
            }
            renderItem={({ item }) => {
              const tel = normalizeTel(item.phone) || item.phone;
              const riskScore = clamp(Number(item.risk_level || 0), 0, 100);
              const meta = computeRiskLabel(item.report_count ?? 0, riskScore);
              const tone = toneStyle(meta.tone);

              return (
                <View style={st.card}>
                  <View style={st.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.mainText}>{tel}</Text>
                      <Text style={st.muted}>
                        Risk {riskScore} • {item.report_count ?? 0} reports • blocked {fmtTime(item.blocked_at ?? null)}
                      </Text>
                      {!!item.note && (
                        <Text style={st.note} numberOfLines={2}>
                          {item.note}
                        </Text>
                      )}
                    </View>

                    <View style={st.rightCol}>
                      <View style={[st.badge, { backgroundColor: tone.bg }]}>
                        <Text style={[st.badgeText, { color: tone.fg }]}>{meta.label}</Text>
                      </View>

                      <Pressable onPress={() => unblock(tel)} style={st.actionBtn}>
                        <Ionicons name="lock-open-outline" size={16} color="#e5e7eb" />
                        <Text style={st.actionText}>Unblock</Text>
                      </Pressable>
                    </View>
                  </View>

                  {!!item.tags?.length && (
                    <View style={st.tagsRow}>
                      {item.tags.slice(0, 6).map((t) => (
                        <View key={safeKey(t)} style={st.tag}>
                          <Text style={st.tagText}>{t}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            }}
          />
        )
      ) : tab === "REPORTS" ? (
        reportsLoading ? (
        <View style={st.loadingBox}>
          <ActivityIndicator />
          <Text style={st.muted}>กำลังโหลด...</Text>
        </View>
      ) : (
        <FlatList
          data={reportsFiltered}
          keyExtractor={(it, idx) =>
            it.kind === "PHONE"
              ? `P:${normalizeTel(it.phone || "") || it.phone || "x"}:${it.created_at || it.updated_at || idx}`
              : `B:${normalizeBankAccount(it.account || "") || it.account || "x"}:${it.bank_name || ""}:${it.created_at || it.updated_at || idx}`
          }
          refreshControl={<RefreshControl refreshing={reportsRefreshing} onRefresh={refreshReports} tintColor="#fff" />}
          contentContainerStyle={{ paddingBottom: 18 }}
          ListEmptyComponent={
            <View style={st.emptyBox}>
              <Text style={st.emptyTitle}>ยังไม่มีรายงาน</Text>
              <Text style={st.muted}>เมื่อคุณ report เบอร์/บัญชี จะมาแสดงที่นี่</Text>
            </View>
          }
          renderItem={({ item }) => {
            const riskScore = clamp(Number(item.risk_level || 0), 0, 100);
            const meta = computeRiskLabel(item.report_count ?? 0, riskScore);
            const tone = toneStyle(meta.tone);

            const title =
              item.kind === "PHONE"
                ? normalizeTel(item.phone || "") || item.phone || "-"
                : `${item.bank_name ? item.bank_name + " • " : ""}${normalizeBankAccount(item.account || "") || item.account || "-"}`;

            const when = item.updated_at || item.created_at || null;

            return (
              <View style={st.card}>
                <View style={st.cardTop}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <View style={st.kindPill}>
                        <Ionicons name={item.kind === "PHONE" ? "call-outline" : "card-outline"} size={14} color="#cbd5e1" />
                        <Text style={st.kindText}>{item.kind}</Text>
                      </View>

                      <Text style={st.mainText}>{title}</Text>
                    </View>

                    <Text style={st.muted}>
                      {item.category ? `Category: ${item.category} • ` : ""}
                      Risk {riskScore} • {item.report_count ?? 0} reports • {fmtTime(when)}
                    </Text>

                    {!!item.note && (
                      <Text style={st.note} numberOfLines={3}>
                        {item.note}
                      </Text>
                    )}
                  </View>

                  <View style={st.rightCol}>
                    <View style={[st.badge, { backgroundColor: tone.bg }]}>
                      <Text style={[st.badgeText, { color: tone.fg }]}>{meta.label}</Text>
                    </View>
                  </View>
                </View>

                {!!item.tags?.length && (
                  <View style={st.tagsRow}>
                    {item.tags.slice(0, 6).map((t) => (
                      <View key={safeKey(t)} style={st.tag}>
                        <Text style={st.tagText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      )
      ) : historyLoading ? (
        <View style={st.loadingBox}>
          <ActivityIndicator />
          <Text style={st.muted}>กำลังโหลด...</Text>
        </View>
      ) : (
        <FlatList
          data={historyFiltered}
          keyExtractor={(it) => String(it.id)}
          refreshControl={<RefreshControl refreshing={historyRefreshing} onRefresh={refreshHistory} tintColor="#fff" />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMoreHistory}
          contentContainerStyle={{ paddingBottom: 18 }}
          ListEmptyComponent={
            <View style={st.emptyBox}>
              <Text style={st.emptyTitle}>ยังไม่มีประวัติ</Text>
              <Text style={st.muted}>เมื่อมีการบล็อก/เตือนสายหรือ SMS จะมาแสดงที่นี่</Text>
            </View>
          }
          ListFooterComponent={
            historyHasMore ? (
              <View style={{ paddingVertical: 12 }}>
                <ActivityIndicator />
              </View>
            ) : (
              <View style={{ paddingVertical: 12 }}>
                <Text style={[st.muted, { textAlign: "center" }]}>จบรายการ</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const meta = parseHistoryDetail(item.detail);
            const action = meta?.action || "-";
            const source = meta?.source || "-";
            const note = meta?.note || "";

            return (
              <View style={st.card}>
                <Text style={st.mainText}>{item.phone_normalized}</Text>
                <Text style={st.muted}>
                  {item.type.toUpperCase()} • {action} • {source} • {fmtTime(item.created_at)}
                </Text>
                {!!note && (
                  <Text style={st.note} numberOfLines={3}>
                    {note}
                  </Text>
                )}
              </View>
            );
          }}
        />
      )}

      {hiddenDiag.enabled ? (
        <Modal visible={inspectOpen} animationType="slide" onRequestClose={closeInspectDb} presentationStyle="pageSheet">
          <View style={st.inspectWrap}>
            <View style={st.inspectTopBar}>
              <View style={{ flex: 1 }}>
                <Text style={st.inspectTitle}>Inspect DB</Text>
                <Text style={st.inspectSubtitle} numberOfLines={2}>
                  {inspectPayload?.dbName ? `DB: ${inspectPayload.dbName}` : "DB"}
                  {inspectPayload?.dbPath ? `\n${inspectPayload.dbPath}` : ""}
                </Text>
              </View>

              <Pressable onPress={closeInspectDb} style={st.inspectCloseBtn}>
                <Ionicons name="close-outline" size={20} color="#e5e7eb" />
                <Text style={st.inspectCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={st.inspectScroll}>
              {!!inspectError && <Text style={st.inspectError}>Error: {inspectError}</Text>}

              <View style={st.inspectActionsRow}>
                <Pressable
                  onPress={() => copyText("full inspector JSON", toJsonText(inspectPayload))}
                  style={st.inspectActionBtn}
                >
                  <Ionicons name="copy-outline" size={16} color="#e5e7eb" />
                  <Text style={st.inspectActionText}>Copy JSON</Text>
                </Pressable>

                {!!inspectSelected ? (
                  <Pressable
                    onPress={() => {
                      setInspectSelected("");
                      // keep the current table list payload; just hide detail.
                    }}
                    style={st.inspectActionBtn}
                  >
                    <Ionicons name="arrow-back-outline" size={16} color="#e5e7eb" />
                    <Text style={st.inspectActionText}>Clear table</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={st.inspectSectionCard}>
                <Text style={st.inspectSectionTitle}>Tables</Text>
                <Text style={st.inspectSectionHint}>Tap a table to load schema + last 50 rows.</Text>

                {inspectLoading ? (
                  <View style={st.inspectLoadingRow}>
                    <ActivityIndicator />
                    <Text style={st.muted}>Loading…</Text>
                  </View>
                ) : null}

                {inspectTables.map((t) => {
                  const isOn = inspectSelected === t.name;
                  const countText = typeof t.count === "number" ? String(t.count) : "?";

                  return (
                    <Pressable
                      key={safeKey(t.name)}
                      onPress={() => selectInspectTable(t.name)}
                      style={[st.inspectTableRow, isOn && st.inspectTableRowOn]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={st.inspectTableName} numberOfLines={1}>
                          {t.name}
                        </Text>
                        {!!t.error && <Text style={st.inspectTableErr} numberOfLines={2}>{t.error}</Text>}
                      </View>
                      <View style={st.inspectCountPill}>
                        <Text style={st.inspectCountText}>{countText}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {!!inspectSelected ? (
                <View style={st.inspectSectionCard}>
                  <Text style={st.inspectSectionTitle}>Table: {inspectSelected}</Text>

                  <View style={st.inspectActionsRow}>
                    <Pressable
                      onPress={() => copyText("schema", toJsonText(inspectPayload?.selectedTableSchema || []))}
                      style={st.inspectActionBtn}
                    >
                      <Ionicons name="copy-outline" size={16} color="#e5e7eb" />
                      <Text style={st.inspectActionText}>Copy schema</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => copyText("rows", toJsonText(inspectPayload?.selectedTableRows || []))}
                      style={st.inspectActionBtn}
                    >
                      <Ionicons name="copy-outline" size={16} color="#e5e7eb" />
                      <Text style={st.inspectActionText}>Copy rows</Text>
                    </Pressable>
                  </View>

                  <Text style={st.inspectSubhead}>Schema (PRAGMA table_info)</Text>
                  <Text selectable style={st.inspectMono}>
                    {toJsonText(inspectPayload?.selectedTableSchema || [])}
                  </Text>

                  <Text style={st.inspectSubhead}>Rows (SELECT * LIMIT 50)</Text>
                  <Text selectable style={st.inspectMono}>
                    {toJsonText(inspectPayload?.selectedTableRows || [])}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </Modal>
      ) : null}

      {hiddenDiag.enabled ? (
        <Modal visible={exportOpen} animationType="slide" onRequestClose={closeExportDbDebug} presentationStyle="pageSheet">
          <View style={st.inspectWrap}>
            <View style={st.inspectTopBar}>
              <View style={{ flex: 1 }}>
                <Text style={st.inspectTitle}>Export DB Debug</Text>
                <Text style={st.inspectSubtitle} numberOfLines={2}>
                  Full SQLite dump (tables, schemas, sample rows, screen queries, last write, last lookup)
                </Text>
              </View>

              <Pressable onPress={closeExportDbDebug} style={st.inspectCloseBtn}>
                <Ionicons name="close-outline" size={20} color="#e5e7eb" />
                <Text style={st.inspectCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={st.inspectScroll}>
              {!!exportError && <Text style={st.inspectError}>Error: {exportError}</Text>}

              <View style={st.inspectActionsRow}>
                <Pressable
                  onPress={() => copyText("DB export", exportText)}
                  disabled={!exportText}
                  style={[st.inspectActionBtn, !exportText && { opacity: 0.5 }]}
                >
                  <Ionicons name="copy-outline" size={16} color="#e5e7eb" />
                  <Text style={st.inspectActionText}>Copy</Text>
                </Pressable>
              </View>

              {exportLoading ? (
                <View style={st.inspectLoadingRow}>
                  <ActivityIndicator />
                  <Text style={st.muted}>Exporting…</Text>
                </View>
              ) : null}

              <View style={st.inspectSectionCard}>
                <Text style={st.inspectSectionTitle}>Payload</Text>
                <Text selectable style={st.inspectMono}>
                  {exportText || "(empty)"}
                </Text>
              </View>
            </ScrollView>
          </View>
        </Modal>
      ) : null}

      {hiddenDiag.enabled ? (
        <Modal visible={lookupOpen} animationType="slide" onRequestClose={closeLookupDebug} presentationStyle="pageSheet">
          <View style={st.inspectWrap}
          >
            <View style={st.inspectTopBar}>
              <View style={{ flex: 1 }}>
                <Text style={st.inspectTitle}>Lookup Number</Text>
                <Text style={st.inspectSubtitle} numberOfLines={2}>
                  Runs the exact native normalization + SQLite lookup used by CallScreeningService
                </Text>
              </View>

              <Pressable onPress={closeLookupDebug} style={st.inspectCloseBtn}>
                <Ionicons name="close-outline" size={20} color="#e5e7eb" />
                <Text style={st.inspectCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={st.inspectScroll} keyboardShouldPersistTaps="handled">
              {!!lookupError && <Text style={st.inspectError}>Error: {lookupError}</Text>}

              <View style={st.inspectSectionCard}>
                <Text style={st.inspectSectionTitle}>Input</Text>
                <TextInput
                  value={lookupInput}
                  onChangeText={setLookupInput}
                  placeholder="Enter phone number (any format)"
                  placeholderTextColor="#667085"
                  keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "phone-pad"}
                  style={st.inspectInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View style={st.inspectActionsRow}>
                  <Pressable
                    onPress={runLookupDebug}
                    disabled={lookupLoading || !lookupInput.trim()}
                    style={[st.inspectActionBtn, (lookupLoading || !lookupInput.trim()) && { opacity: 0.5 }]}
                  >
                    {lookupLoading ? <ActivityIndicator /> : <Ionicons name="play-outline" size={16} color="#e5e7eb" />}
                    <Text style={st.inspectActionText}>Run lookup</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => copyText("lookup JSON", toJsonText(lookupResult))}
                    disabled={!lookupResult}
                    style={[st.inspectActionBtn, !lookupResult && { opacity: 0.5 }]}
                  >
                    <Ionicons name="copy-outline" size={16} color="#e5e7eb" />
                    <Text style={st.inspectActionText}>Copy JSON</Text>
                  </Pressable>
                </View>
              </View>

              <View style={st.inspectSectionCard}>
                <Text style={st.inspectSectionTitle}>Result</Text>
                <Text selectable style={st.inspectMono}>
                  {toJsonText(lookupResult) || "(empty)"}
                </Text>
              </View>
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f19", paddingHorizontal: 14, paddingTop: 12 },

  hTitle: { color: "#fff", fontSize: 20, lineHeight: 24, fontWeight: "900" },
  hSub: { color: "#98a2b3", marginTop: 4, lineHeight: 18 },

  headerBlock: { paddingTop: 6, paddingBottom: 10 },

  segmentWrap: { alignItems: "flex-start", marginBottom: 12 },
  segmentScroll: { paddingRight: 8 },
  segmentPill: {
    flexDirection: "row",
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
    padding: 2,
  },
  segmentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    minHeight: 36,
    flexShrink: 1,
  },
  segmentBtnOn: { backgroundColor: "#e5e7eb" },
  segmentText: { color: "#cbd5e1", fontWeight: "900", fontSize: 13 },

  searchRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1a2240",
    backgroundColor: "#0e1426",
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, paddingVertical: 0 },
  clearBtn: { width: 30, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
    minHeight: 34,
  },
  pillOn: { backgroundColor: "#e5e7eb", borderColor: "#e5e7eb" },
  pillText: { color: "#cbd5e1", fontWeight: "900", fontSize: 13 },

  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, marginTop: 20 },
  muted: { color: "#98a2b3" },

  emptyBox: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
    marginTop: 14,
  },
  emptyTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },

  card: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
    marginTop: 12,
  },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },

  mainText: { color: "#fff", fontWeight: "950" as any, fontSize: 18 },
  note: { marginTop: 6, color: "#e5e7eb" },

  rightCol: { alignItems: "flex-end", gap: 10 },

  badge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  badgeText: { fontWeight: "900" },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#111116",
  },
  actionText: { color: "#e5e7eb", fontWeight: "900" },

  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)" },
  tagText: { color: "#cbd5e1", fontWeight: "800", fontSize: 12 },

  kindPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  kindText: { color: "#cbd5e1", fontWeight: "900", fontSize: 12 },

  // NATIVE_BLOCKED debug UI
  nativeHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  nativeTitle: { color: "#fff", fontWeight: "900", fontSize: 16, lineHeight: 20 },

  nativeMeta: { marginTop: 6, gap: 4 },
  nativeMetaLine: { color: "#98a2b3", fontSize: 12, lineHeight: 16 },
  nativeCountsLine: { color: "#cbd5e1", fontSize: 12, lineHeight: 16, fontWeight: "800" },

  nativeRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#111116",
  },
  nativeActionsCol: { alignItems: "flex-end", gap: 8 },
  nativeRefreshBtnDisabled: { opacity: 0.6 },
  nativeRefreshText: { color: "#e5e7eb", fontWeight: "900", fontSize: 13 },
  nativeError: { color: "#fca5a5", marginTop: 10, fontWeight: "800" },

  nativeRowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  nativeBadges: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" },
  nativeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  nativeBadgeText: { color: "#cbd5e1", fontWeight: "900", fontSize: 12 },
  nativeBadgeLocal: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  nativeBadgeSpam: { backgroundColor: "#f59e0b", borderColor: "#f59e0b" },

  nativeUnblockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  nativeUnblockText: { color: "#111", fontWeight: "900" },

  nativeItemMeta: { marginTop: 6, lineHeight: 18 },

  // Inspect DB modal
  inspectWrap: { flex: 1, backgroundColor: "#0b0f19" },
  inspectTopBar: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#141c36",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  inspectTitle: { color: "#fff", fontSize: 18, fontWeight: "950" as any },
  inspectSubtitle: { color: "#98a2b3", marginTop: 4, fontSize: 12, lineHeight: 16 },
  inspectCloseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#111116",
  },
  inspectCloseText: { color: "#e5e7eb", fontWeight: "900" },
  inspectScroll: { paddingHorizontal: 14, paddingBottom: 24 },
  inspectError: { color: "#fca5a5", marginTop: 10, fontWeight: "800" },
  inspectInput: {
    marginTop: 10,
    color: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0b0f19",
  },
  inspectActionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  inspectActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#111116",
  },
  inspectActionText: { color: "#e5e7eb", fontWeight: "900" },
  inspectSectionCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0c1224",
    marginTop: 12,
  },
  inspectSectionTitle: { color: "#fff", fontWeight: "950" as any, fontSize: 16 },
  inspectSectionHint: { color: "#98a2b3", marginTop: 6, fontSize: 12, lineHeight: 16 },
  inspectLoadingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  inspectTableRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  inspectTableRowOn: { borderColor: "#27335f", backgroundColor: "rgba(229,231,235,0.08)" },
  inspectTableName: { color: "#fff", fontWeight: "900" },
  inspectTableErr: { color: "#fca5a5", marginTop: 4, fontSize: 12, lineHeight: 16 },
  inspectCountPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "rgba(255,255,255,0.06)",
    minWidth: 44,
    alignItems: "center",
  },
  inspectCountText: { color: "#cbd5e1", fontWeight: "900" },
  inspectSubhead: { color: "#cbd5e1", fontWeight: "900", marginTop: 12, marginBottom: 6 },
  inspectMono: {
    color: "#e5e7eb",
    fontSize: 12,
    lineHeight: 16,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#141c36",
    backgroundColor: "#0b0f19",
  },
});
