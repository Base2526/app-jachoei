import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import Ionicons from "react-native-vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { client } from "../apollo/client";
import { Q_GLOBAL_SEARCH } from "../graphql/globalSearch.gql";
import { HeaderSearchInput } from "../components/HeaderSearchInput";
import { useAuth } from "../auth/AuthProvider";

import type { RootStackParamList } from "../navigation/types";

/* =======================
 * Types
 * ======================= */

type SearchPost = {
  id: string;
  entity_id?: string;
  title: string;
  snippet?: string;
  created_at?: string;
};

type SearchPhone = {
  id: string;
  phone: string;
  ids?: string[];
  report_count: number;
};

type SearchBank = {
  id: string;
  bank_name: string;
  account_no_masked: string;
  ids?: string[];
  report_count: number;
};

type SectionItem =
  | { type: "post"; data: SearchPost }
  | { type: "phone"; data: SearchPhone }
  | { type: "bank"; data: SearchBank };

type Props = NativeStackScreenProps<RootStackParamList, "BlockedLogsSearch">;

/* =======================
 * History config
 * ======================= */

const HISTORY_KEY = "jachoei_global_search_history_v1";
const HISTORY_MAX = 20;

/* =======================
 * Screen
 * ======================= */

export const BlockedLogsSearchScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // history
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ref
  // const debounceRef = useRef<NodeJS.Timeout | null>(null);

  /* =======================
   * Load history on mount
   * ======================= */
  const loadHistory = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      setHistory(Array.isArray(arr) ? arr : []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /* =======================
   * History helpers
   * ======================= */

  const saveHistory = useCallback(async (next: string[]) => {
    setHistory(next);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }, []);

  const addToHistory = useCallback(
    async (term: string) => {
      const t = term.trim();
      if (!t) return;

      const next = [t, ...history.filter((x) => x !== t)].slice(0, HISTORY_MAX);
      await saveHistory(next);
    },
    [history, saveHistory]
  );

  const clearHistory = useCallback(async () => {
    await AsyncStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setShowHistory(false);
  }, []);

  /* =======================
   * Filter history by search
   * - ถ้า search ว่าง: แสดงทั้งหมด (แต่จะโชว์ก็ต่อเมื่อ showHistory=true)
   * - ถ้ามี search: filter แบบ contains
   * ======================= */
  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.toLowerCase().includes(q));
  }, [history, search]);

  // ✅ แสดง overlay เฉพาะเมื่อ:
  // - ผู้ใช้กด/โฟกัส input (showHistory=true)
  // - และมี history ที่ filter แล้วอย่างน้อย 1 รายการ
  const canShowHistory = useMemo(
    () => showHistory && filteredHistory.length > 0,
    [showHistory, filteredHistory.length]
  );

  /* =======================
   * Search logic
   * ======================= */

  const runSearch = useCallback(
    async (q: string) => {
      const term = q.trim();

      if (!term) {
        setItems([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data } = await client.query({
          query: Q_GLOBAL_SEARCH,
          variables: { q: term },
          fetchPolicy: "network-only",
        });

        const res = data?.globalSearch;
        const next: SectionItem[] = [];

        res?.posts?.forEach((p: SearchPost) => next.push({ type: "post", data: p }));
        res?.phones?.forEach((p: SearchPhone) => next.push({ type: "phone", data: p }));
        res?.bank_accounts?.forEach((b: SearchBank) => next.push({ type: "bank", data: b }));

        setItems(next);

        // ✅ เก็บ history เฉพาะ search สำเร็จ
        await addToHistory(term);
      } catch (e: any) {
        setError(e.message || "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [addToHistory]
  );

  /* =======================
   * Header
   * - เข้า screen มา ไม่เปิด history
   * - เปิดเมื่อ focus/click เท่านั้น
   * ======================= */

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",

      headerTitle: () => (
        <HeaderSearchInput
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            // ✅ ถ้ากำลังโชว์ history อยู่ จะ filter ตาม v ทันที (ผ่าน filteredHistory)
            // ✅ ถ้ายังไม่โชว์ จะยังไม่เปิดเอง (ตาม requirement)
          }}
          onClear={() => {
            setSearch("");
            // ✅ ไม่ auto เปิด
          }}
          onFocus={() => {
            // ✅ เปิดเฉพาะตอนผู้ใช้กด input
            setShowHistory(true);
          }}
          onPressHistory={() => {
            // ✅ toggle ด้วยปุ่มใน input ได้
            setShowHistory((s) => !s);
          }}
          onSubmit={async () => {
            // ✅ submit แล้วปิด history
            setShowHistory(false);
            await runSearch(search);
          }}
        />
      ),

      // headerLeft: () => (
      //   <TouchableOpacity
      //     onPress={() => navigation.goBack()}
      //     style={{ paddingHorizontal: 12 }}
      //     hitSlop={10}
      //   >
      //     <Ionicons name="arrow-back" size={22} color="#fff" />
      //   </TouchableOpacity>
      // ),
      // headerBackVisible: false,
    });
  }, [navigation, search, runSearch]);

  /* =======================
   * Navigation
   * ======================= */

  const openPost = (id: string) => {
    setShowHistory(false);
    navigation.navigate("PostView", { id: String(id), currentUserId: user?.id });
  };

  const onPickHistory = async (term: string) => {
    setSearch(term);
    setShowHistory(false);
    await runSearch(term);
  };

  /* =======================
   * Render item
   * ======================= */

  const renderItem = ({ item }: { item: SectionItem }) => {
    if (item.type === "post") {
      const p = item.data;
      return (
        <TouchableOpacity style={styles.card} onPress={() =>{
          openPost(p.id)
        } }>
          <Text style={styles.title}>{p.title}</Text>
          {!!p.snippet && <Text style={styles.sub}>{p.snippet}</Text>}
          {!!p.created_at && (
            <Text style={styles.meta}>{new Date(p.created_at).toLocaleString()}</Text>
          )}
        </TouchableOpacity>
      );
    }

    if (item.type === "phone") {
      const p = item.data;
      return (
        <View style={styles.card}>
          <Text style={styles.title}>{p.phone}</Text>
          <Text style={styles.sub}>{p.report_count} รายงาน</Text>

          {!!p.ids?.length && (
            <View style={styles.actions}>
              {p.ids.map((pid) => (
                <TouchableOpacity
                  key={pid}
                  style={styles.btn}
                  onPress={() => {
                    openPost(pid)
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnText}>ไปยังโพสต์ #{pid}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      );
    }

    if (item.type === "bank") {
      const b = item.data;
      return (
        <View style={styles.card}>
          <Text style={styles.title}>{b.bank_name}</Text>
          <Text style={styles.sub}>{b.account_no_masked}</Text>

          {!!b.ids?.length && (
            <View style={styles.actions}>
              {b.ids.map((pid) => (
                <TouchableOpacity
                  key={pid}
                  style={styles.btn}
                  onPress={() =>{
                    openPost(pid)
                  } }
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnText}>ไปยังโพสต์ #{pid}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      );
    }

    return null;
  };

  /* =======================
   * UI
   * ======================= */

  return (
    <View style={styles.root}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={[styles.emptyText, { marginTop: 10 }]}>กำลังค้นหา…</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && !search && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>พิมพ์เพื่อค้นหา…</Text>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          style={{ backgroundColor: "#0b0b0f" }}
          data={items}
          keyExtractor={(item, idx) => item.type + "-" + idx}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={items.length === 0 ? styles.center : undefined}
          ListEmptyComponent={search ? <Text style={styles.emptyText}>ไม่พบข้อมูล</Text> : null}
          onScrollBeginDrag={() => setShowHistory(false)}
        />
      )}

      {/* ✅ HISTORY OVERLAY (show only on focus/click) */}
      {canShowHistory && (
        <Pressable style={styles.overlay} onPress={() => setShowHistory(false)}>
          <Pressable style={styles.historyCard} onPress={() => {}}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>ประวัติการค้นหา</Text>

              <TouchableOpacity onPress={clearHistory} hitSlop={10}>
                <Text style={styles.clearText}>ล้าง</Text>
              </TouchableOpacity>
            </View>

            {filteredHistory.map((h) => (
              <TouchableOpacity
                key={h}
                style={styles.historyRow}
                onPress={() => onPickHistory(h)}
                activeOpacity={0.85}
              >
                <Ionicons name="time-outline" size={16} color="#9ca3af" />
                <Text style={styles.historyText} numberOfLines={1}>
                  {h}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      )}
    </View>
  );
};

/* =======================
 * Styles
 * ======================= */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f" },

  card: {
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
    backgroundColor: "#0b0b0f",
  },

  title: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sub: { color: "#9ca3af", fontSize: 13, marginTop: 2 },
  meta: { color: "#6b7280", fontSize: 11, marginTop: 4 },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  btn: { backgroundColor: "#1f2937", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnText: { color: "#93c5fd", fontSize: 12, fontWeight: "700" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0b0f",
    paddingHorizontal: 18,
  },

  emptyText: { color: "#6b7280", fontSize: 14 },
  errorText: { color: "#ff3b30", fontSize: 14, textAlign: "center" },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    backgroundColor: "rgba(0,0,0,0.15)",
  },

  historyCard: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    backgroundColor: "#0f0f14",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#222",
    paddingVertical: 10,
    overflow: "hidden",
  },

  historyHeader: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  historyTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  clearText: { color: "#ff3b30", fontWeight: "700", fontSize: 13 },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },

  historyText: { color: "#e5e7eb", fontSize: 15, fontWeight: "600", flex: 1 },
});
