// src/screens/SafetyCenterMyListsTab.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  TextInput,
  Alert,
  RefreshControl,
  Platform,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";

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
  mutation UnblockPhone($phone: String!) {
    unblockPhone(phone: $phone) {
      ok
      phone
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

function safeKey(s: string) {
  return String(s || "").replace(/\s+/g, "_");
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
      <View style={st.segmentPill}>
        {items.map((it) => {
          const on = value === it.key;
          return (
            <Pressable key={it.key} onPress={() => onChange(it.key)} style={[st.segmentBtn, on && st.segmentBtnOn]}>
              <Ionicons name={it.icon as any} size={16} color={on ? "#111" : "#cbd5e1"} />
              <Text style={[st.segmentText, on && { color: "#111" }]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ======================================================
// Screen
// ======================================================
export default function SafetyCenterMyListsTab() {
  const LIMIT_BLOCKED = 50;
  const LIMIT_REPORTS = 80;

  const [tab, setTab] = useState<"BLOCKED" | "REPORTS">("BLOCKED");

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

  useEffect(() => {
    loadBlockedInitial();
    loadReportsInitial();
  }, [loadBlockedInitial, loadReportsInitial]);

  // ---------------------------------
  // Unblock
  // ---------------------------------
  const unblock = useCallback(async (phone: string) => {
    const tel = normalizeTel(phone) || phone;
    Alert.alert("Unblock เบอร์นี้?", tel, [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "Unblock",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await client.mutate<{ unblockPhone: { ok: boolean; phone: string } }>({
              mutation: UNBLOCK_PHONE,
              variables: { phone: tel },
            });

            const ok = res.data?.unblockPhone?.ok;
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

  const summaryText = useMemo(() => (tab === "BLOCKED" ? `${blockedFiltered.length} รายการ` : `${reportsFiltered.length} รายการ`), [
    tab,
    blockedFiltered.length,
    reportsFiltered.length,
  ]);

  return (
    <View style={st.container}>
      <SegmentedTabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        items={[
          { key: "BLOCKED", label: "Blocked", icon: "lock-closed-outline" },
          { key: "REPORTS", label: "My Reports", icon: "megaphone-outline" },
        ]}
      />

      <View style={{ paddingBottom: 8 }}>
        <Text style={st.hTitle}>{tab === "BLOCKED" ? "Blocked (เบอร์ที่บล็อก)" : "My Reports (ที่รายงานไป)"}</Text>
        <Text style={st.hSub}>{summaryText}</Text>
      </View>

      <View style={st.searchRow}>
        <Ionicons name="search-outline" size={18} color="#9ca3af" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={tab === "BLOCKED" ? "ค้นหาเบอร์ที่บล็อก..." : "ค้นหา phone / bank / note ..."}
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

      {tab === "REPORTS" ? (
        <View style={[st.filterRow, { marginTop: 8 }]}>
          <Pill label="ALL" active={reportType === "ALL"} onPress={() => setReportType("ALL")} />
          <Pill label="PHONE" active={reportType === "PHONE"} onPress={() => setReportType("PHONE")} icon="call-outline" />
          <Pill label="BANK" active={reportType === "BANK"} onPress={() => setReportType("BANK")} icon="card-outline" />
        </View>
      ) : null}

      {tab === "BLOCKED" ? (
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
      ) : reportsLoading ? (
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
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f19", paddingHorizontal: 14, paddingTop: 10 },

  hTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  hSub: { color: "#98a2b3", marginTop: 4 },

  segmentWrap: { alignItems: "flex-start", marginBottom: 10 },
  segmentPill: {
    flexDirection: "row",
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
  },
  segmentBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  segmentBtnOn: { backgroundColor: "#e5e7eb" },
  segmentText: { color: "#cbd5e1", fontWeight: "900", fontSize: 14 },

  searchRow: {
    marginTop: 10,
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

  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27335f",
    backgroundColor: "#0e1426",
  },
  pillOn: { backgroundColor: "#e5e7eb", borderColor: "#e5e7eb" },
  pillText: { color: "#cbd5e1", fontWeight: "900" },

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
    marginTop: 10,
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
});
