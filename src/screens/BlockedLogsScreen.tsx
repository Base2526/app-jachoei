// src/screens/BlockedLogsScreen.tsx
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { loadBlockedLogs, BlockedLog } from "../lib/db-blocked-logs";

type FilterType = "all" | "call" | "sms";

export const BlockedLogsScreen: React.FC = () => {
  const [logs, setLogs] = useState<BlockedLog[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const typeFilter =
        filter === "all" ? undefined : (filter as "call" | "sms");
      const rows = await loadBlockedLogs({
        type: typeFilter,
        search,
        limit: 200,
      });
      setLogs(rows);
    } catch (e) {
      console.log("[BlockedLogs] load error", e);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderItem = ({ item }: { item: BlockedLog }) => {
    const icon = item.type === "call" ? "📞" : "📩";
    const timeText = formatDateTime(item.created_at);

    return (
      <View style={styles.itemContainer}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>{icon}</Text>
        </View>

        <View style={styles.itemContent}>
          <View style={styles.itemRow}>
            <Text style={styles.phoneText}>{item.phone_normalized}</Text>
            <Text style={styles.typeTag}>
              {item.type === "call" ? "CALL" : "SMS"}
            </Text>
          </View>

          {item.raw_phone && item.raw_phone !== item.phone_normalized && (
            <Text style={styles.rawText}>raw: {item.raw_phone}</Text>
          )}

          {item.detail ? (
            <Text style={styles.detailText} numberOfLines={2}>
              {item.detail}
            </Text>
          ) : null}

          <Text style={styles.timeText}>{timeText}</Text>
        </View>
      </View>
    );
  };

  const onChangeFilter = (f: FilterType) => {
    setFilter(f);
  };

  const onSubmitSearch = () => {
    loadData();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Blocked Activity</Text>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="ค้นหาเบอร์ / รหัสประเทศ"
          placeholderTextColor="#999"
          returnKeyType="search"
          onSubmitEditing={onSubmitSearch}
        />
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        <FilterTab
          label="All"
          active={filter === "all"}
          onPress={() => onChangeFilter("all")}
        />
        <FilterTab
          label="Calls"
          active={filter === "call"}
          onPress={() => onChangeFilter("call")}
        />
        <FilterTab
          label="SMS"
          active={filter === "sms"}
          onPress={() => onChangeFilter("sms")}
        />
      </View>

      {/* List */}
      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={
          logs.length === 0 ? styles.emptyContainer : undefined
        }
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadData} />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyText}>ยังไม่มีประวัติการบล็อก</Text>
          ) : null
        }
      />
    </View>
  );
};

type FilterTabProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

const FilterTab: React.FC<FilterTabProps> = ({ label, active, onPress }) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

function formatDateTime(value: string): string {
  // value มาจาก sqlite TEXT (เช่น "2025-12-04 15:20:30")
  // ถ้าจัดรูปแบบเอง:
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return value;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: "#0b0b0f",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
    color: "#ffffff",
  },
  searchRow: {
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: "#1d1d25",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#fff",
    borderWidth: 1,
    borderColor: "#333",
  },
  tabsRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 6,
    marginRight: 6,
    borderRadius: 999,
    backgroundColor: "#1a1a22",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabButtonActive: {
    backgroundColor: "#2563eb",
    borderColor: "#3b82f6",
  },
  tabText: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#fff",
  },
  itemContainer: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
  },
  iconContainer: {
    width: 32,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  iconText: {
    fontSize: 20,
  },
  itemContent: {
    flex: 1,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  phoneText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  typeTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#f97316",
    backgroundColor: "#451a03",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  rawText: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
  },
  detailText: {
    fontSize: 13,
    color: "#e5e7eb",
    marginTop: 2,
  },
  timeText: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  emptyText: {
    color: "#6b7280",
    fontSize: 14,
  },
});
