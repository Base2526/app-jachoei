// src/screens/HomeScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Dimensions,
  Platform,
  Share,
  Linking,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThumbGrid } from "../components/ThumbGrid";
// import { Dimensions } from "react-native";

import { client } from "../apollo/client";
import { ENV } from "../config/env";

import type { RootStackParamList } from "../navigation/types";

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

type Img = { id: string | number; url: string };

type PostItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  created_at?: string | null;

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

// type RootStackParamList = {
//   Home: undefined;
//   PostView: { post: object };
// };

/** =========================================================
 * HomeScreen
 * ========================================================= */
export const HomeScreen: React.FC = () => {
  const [items, setItems] = useState<PostItem[]>([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [q] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const canLoadMore = items.length < total;

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const openUrl = useCallback(async (url?: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("เปิดลิงก์ไม่ได้", url);
    }
  }, []);

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
    } catch (e: any) {
      Alert.alert("Load error", e?.message || "unknown");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

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
    } catch {
      // ignore cancel
    }
  }, []);

  const renderPostItem = useCallback(
    ({ item }: { item: PostItem }) => {
        const ts = formatDateTime(item.created_at);
        const status = item.status || undefined;
        const sc = statusColor(status);

        const published = isFacebookPublished(item);

        const telList = (item.tel_numbers || [])
        .map((t) => t.tel)
        .filter(Boolean);

        const bankList = (item.seller_accounts || [])
        .map((a) => `${a.bank_name || "-"}: ${a.seller_account || "-"}`)
        .filter(Boolean);

        const onOpenPost = () => {

          console.log("onOpenPost = ", item);

          navigation.navigate("PostView", {
            post: item
          });
        };

        return (
        <Pressable
            onPress={onOpenPost}
            android_ripple={{ color: "#222" }}
            style={({ pressed }) => [
            styles.card,
            pressed && { opacity: 0.85 },
            ]}
        >
            {/* ===== TOP ===== */}
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

            <Text style={styles.meta} numberOfLines={1}>
            {ts}
            {item.author?.name ? ` • by ${item.author.name}` : ""}
            </Text>

            {/* ===== THUMB GRID ===== */}
            <View style={{ marginTop: 10 }}>
            <ThumbGrid
                images={(item.images || []) as any}
                width={Dimensions.get("window").width - 24 - 20}
                height={160}
                radius={14}
                gap={6}
            />
            </View>

            {/* ===== DETAIL ===== */}
            {item.detail ? (
            <Text style={styles.detail} numberOfLines={4}>
                {item.detail}
            </Text>
            ) : null}

            {/* ===== TEL ===== */}
            <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Tel:</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
                {telList[0] || "-"}
            </Text>
            {telList.length > 1 ? (
                <Text style={styles.moreText}> (+{telList.length - 1})</Text>
            ) : null}
            </View>

            {/* ===== BANK ===== */}
            <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Bank:</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
                {bankList[0] || "-"}
            </Text>
            {bankList.length > 1 ? (
                <Text style={styles.moreText}> (+{bankList.length - 1})</Text>
            ) : null}
            </View>

            {/* ===== ACTIONS ===== */}
            <View style={styles.actionsRow}>
            <IconButton
                icon="logo-facebook"
                disabled={!published}
                onPress={() => {
                  // e.stopPropagation();
                  openUrl(item.fb_permalink_url);
                }}
            />

            <IconButton
                icon="chatbubble-ellipses-outline"
                badge={item.comments_count || 0}
                onPress={() => {
                // e.stopPropagation();
                // navigation.navigate("PostView", { postId: item.id });
                }}
            />

            <IconButton
                icon="share-social-outline"
                onPress={() => {
                  // e.stopPropagation();
                  // handleShare(item);
                }}
            />

            <View style={{ flex: 1 }} />

            <IconButton
                icon="link-outline"
                onPress={() => {
                  // e.stopPropagation();
                  // openUrl(`${ENV.webBase ?? "https://jachoei.com"}/post/${item.id}`);
                }}
            />
            </View>
        </Pressable>
        );
    },
    [handleShare, openUrl, navigation]
  );


  const footer = useMemo(() => {
    if (!canLoadMore) return <View style={{ height: 24 }} />;
    return (
      <View style={styles.footer}>
        {loadingMore ? <ActivityIndicator /> : null}
        <Text style={styles.footerText}>{loadingMore ? "กำลังโหลดเพิ่ม..." : ""}</Text>
      </View>
    );
  }, [canLoadMore, loadingMore]);

  return (
    <View style={styles.container}>
      {/* header */}
      {/* <View style={styles.header}>
        <Text style={styles.headerTitle}>จ่าเฉย (JACHOEI)</Text>
        <TouchableOpacity
          onPress={() => openUrl(`${ENV.webBase ?? "https://jachoei.com"}/search`)}
          style={styles.headerBtn}
        >
          <Ionicons name="search-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View> */}

      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderPostItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={loading && page === 1} onRefresh={onRefresh} />
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
    </View>
  );
};

function IconButton(props: {
  icon: string;
  onPress: () => void;
  disabled?: boolean;
  badge?: number;
}) {
  const { icon, onPress, disabled, badge } = props;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.iconBtn, disabled && { opacity: 0.35 }]}
    >
      <Ionicons name={icon as any} size={18} color="#e5e7eb" />
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : String(badge)}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },

  header: {
    height: 52,
    paddingHorizontal: 12,
    backgroundColor: "#111",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1d1d25",
  },

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

  meta: { marginTop: 4, color: "#9ca3af", fontSize: 11 },
  detail: { marginTop: 10, color: "#e5e7eb", fontSize: 12, lineHeight: 16 },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  infoLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "800" },
  infoValue: { flex: 1, color: "#fff", fontSize: 12 },
  moreText: { color: "#9ca3af", fontSize: 12 },

  actionsRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
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

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyText: { color: "#6b7280", fontSize: 14 },

  footer: { paddingVertical: 16, alignItems: "center", gap: 8 },
  footerText: { color: "#9ca3af", fontSize: 12 },
});
