import React, { useEffect, useLayoutEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import Ionicons from "react-native-vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { RootStackParamList } from "../navigation/types";
import { HeaderSearchInput } from "../components/HeaderSearchInput";
import { loadBlockedLogs, BlockedLog } from "../lib/db-blocked-logs";

type Props = NativeStackScreenProps<RootStackParamList, "BlockedLogsSearch">;

const HISTORY_KEY = "blocked_logs_search_history_v1";
const HISTORY_MAX = 20;

export const BlockedLogsSearchScreen: React.FC<Props> = ({ navigation }) => {
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<BlockedLog[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: {
        backgroundColor: "#0b0b0f",
      },
      headerTintColor: "#fff",
    });
  }, [navigation]);

  const canShowHistory = useMemo(
    () => showHistory && history.length > 0,
    [showHistory, history.length]
  );

  const loadHistory = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      setHistory(Array.isArray(arr) ? arr : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const saveHistory = useCallback(async (items: string[]) => {
    setHistory(items);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
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

  // Header config
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <HeaderSearchInput
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            setShowHistory(true);
          }}
          onClear={() => setSearch("")}
          onFocus={() => setShowHistory(true)}
          onPressHistory={() => setShowHistory((s) => !s)}
          onSubmit={async () => {
            setShowHistory(false);
            await addToHistory(search);
          }}
        />
      ),

      // ✅ ทำให้ชิดซ้าย: ใช้ headerLeft แบบ custom + padding น้อย
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ paddingLeft: 10, paddingRight: 6 }}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      ),

      headerBackVisible: false,
    });
  }, [navigation, search, addToHistory]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load logs by search
  useEffect(() => {
    const load = async () => {
      const rows = await loadBlockedLogs({ search, limit: 200 });
      setLogs(rows);
    };
    load();
  }, [search]);

  const onPickHistory = async (term: string) => {
    setSearch(term);
    setShowHistory(false);
    await addToHistory(term);
  };

  const renderItem = ({ item }: { item: BlockedLog }) => (
    <View style={styles.item}>
      <Text style={styles.phone}>{item.phone_normalized}</Text>
      {!!item.detail && <Text style={styles.detail}>{item.detail}</Text>}
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={logs.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.empty}>ไม่พบข้อมูล</Text>}
        onScrollBeginDrag={() => setShowHistory(false)}
      />

      {/* ✅ HISTORY OVERLAY ลอยทับ list */}
      {canShowHistory && (
        <Pressable style={styles.overlay} onPress={() => setShowHistory(false)}>
          <Pressable style={styles.historyCard} onPress={() => {}}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>ประวัติการค้นหา</Text>

              <TouchableOpacity onPress={clearHistory} hitSlop={10}>
                <Text style={styles.clearText}>ล้าง</Text>
              </TouchableOpacity>
            </View>

            {history.map((h) => (
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0b0b0f",
  },

  item: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
  },
  phone: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  detail: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 2,
  },

  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  empty: {
    color: "#6b7280",
    fontSize: 14,
  },

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
  historyTitle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  clearText: {
    color: "#ff3b30",
    fontWeight: "700",
    fontSize: 13,
  },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  historyText: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
});
