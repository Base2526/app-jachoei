import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  Alert,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { gql } from "@apollo/client";

import { client } from "../apollo/client";

const Q_NOTIFICATIONS = gql`
  query MyNotifications($limit: Int, $offset: Int) {
    myNotifications(limit: $limit, offset: $offset) {
      id
      type
      entity_type
      title
      message
      is_read
      created_at
    }
  }
`;

const Q_UNREAD_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

const MUT_MARK_READ = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id)
  }
`;

const MUT_MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

function getTimeLabel(created_at: string | number): string {
  let created: Date;
  if (typeof created_at === "number") created = new Date(created_at);
  else if (/^\d+$/.test(created_at)) created = new Date(parseInt(created_at, 10));
  else created = new Date(created_at);

  if (isNaN(created.getTime())) return "Invalid date";

  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return created.toLocaleDateString();
}

type NotificationItem = {
  id: string;
  type?: string | null;
  entity_type?: string | null;
  title?: string | null;
  message?: string | null;
  is_read?: boolean | null;
  created_at: string | number;
};

export const NotificationPage: React.FC = () => {
  const limit = 50;
  const offset = 0;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const load = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      const isRefresh = !!opts?.isRefresh;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      setErrorText(null);

      try {
        const [nRes, uRes] = await Promise.all([
          client.query({
            query: Q_NOTIFICATIONS,
            variables: { limit, offset },
            fetchPolicy: "network-only",
          }),
          client.query({
            query: Q_UNREAD_COUNT,
            fetchPolicy: "network-only",
          }),
        ]);

        setNotifications(nRes.data?.myNotifications ?? []);
        setUnreadCount(uRes.data?.myUnreadNotificationCount ?? 0);
      } catch (e) {
        setErrorText("Failed to load notifications");
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [limit, offset]
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    load({ isRefresh: true });
  }, [load]);

  const onMarkAllRead = useCallback(async () => {
    try {
      await client.mutate({ mutation: MUT_MARK_ALL_READ });
      onRefresh();
    } catch (e) {
      Alert.alert("Error", "Failed to mark all as read");
    }
  }, [onRefresh]);

  const onMarkSingleRead = useCallback(
    async (id: string, is_read?: boolean | null) => {
      if (is_read) return;
      try {
        await client.mutate({ mutation: MUT_MARK_READ, variables: { id } });
        onRefresh();
      } catch (e) {
        Alert.alert("Error", "Failed to mark as read");
      }
    },
    [onRefresh]
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => {
      const isRead = !!item.is_read;
      return (
        <Pressable
          style={[styles.item, !isRead && styles.unreadItem]}
          onPress={() => {
            onMarkSingleRead(item.id, item.is_read);
            // TODO: open detail or link if available
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, !isRead && styles.unreadTitle]}>
              {item.title ?? "(No title)"}
            </Text>
            <Text style={styles.message} numberOfLines={2}>
              {item.message ?? ""}
            </Text>
            <Text style={styles.time}>{getTimeLabel(item.created_at)}</Text>
          </View>
          {!isRead && <View style={styles.unreadDot} />}
        </Pressable>
      );
    },
    [onMarkSingleRead]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
          </View>
        )}
        <Pressable
          style={styles.markAllBtn}
          onPress={onMarkAllRead}
          disabled={unreadCount === 0}
        >
          <Text style={[styles.markAllBtnText, unreadCount === 0 && { opacity: 0.5 }]}>
            Mark all as read
          </Text>
        </Pressable>
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color="#2563eb" />
        </View>
      )}

      {!loading && !!errorText && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      )}

      {!loading && !errorText && notifications.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No notifications.</Text>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f", padding: 14 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "900", flex: 1 },
  badge: {
    backgroundColor: "#ff3b30",
    borderRadius: 8,
    minWidth: 24,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    paddingHorizontal: 6,
  },
  badgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  markAllBtn: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#222",
  },
  markAllBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 32 },
  errorText: { color: "#ff3b30", fontSize: 15, fontWeight: "700" },
  emptyText: { color: "#6b7280", fontSize: 15, fontWeight: "700" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#18181b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  unreadItem: { backgroundColor: "#2563eb22" },
  title: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  unreadTitle: { color: "#2563eb" },
  message: { color: "#e5e7eb", fontSize: 13, marginBottom: 2 },
  time: { color: "#9ca3af", fontSize: 12 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2563eb", marginLeft: 8 },
});

export default NotificationPage;