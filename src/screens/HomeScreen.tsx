// src/screens/HomeScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Pressable,
  Dimensions,
  Platform,
  Share,
  Linking,
  Image,
  GestureResponderEvent,
  Modal,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThumbGrid } from "../components/ThumbGrid";
import { client } from "../apollo/client";
import { ENV } from "../config/env";

import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthProvider";

import {
  BottomSheetBlockReportModal,
  BottomSheetBlockReportModalRef,
} from "../components/BottomSheetBlockReportModal";

import {
  BottomSheetReportBankModal,
  BottomSheetReportBankModalRef,
} from "../components/BottomSheetReportBankModal";

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
        is_bookmarked
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

const M_TOGGLE_BOOKMARK = gql`
  mutation ToggleBookmark($postId: ID!) {
    toggleBookmark(postId: $postId) {
      status
      isBookmarked
    }
  }
`;

type PostItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  created_at?: string | null;

  is_bookmarked?: boolean | null;

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

// ====== Local storage ======
const BLOCKED_STORE_KEY = "jachoei.blocked_tel_v1";
const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";

function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function normalizeBankAccount(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

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

export const HomeScreen: React.FC = () => {
  const { isLoggedIn, user } = useAuth();

  const [items, setItems] = useState<PostItem[]>([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [q] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [bookmarkBusyMap, setBookmarkBusyMap] = useState<Record<string, boolean>>(
    {}
  );

  // ✅ blocked tel (local)
  const [blockedMap, setBlockedMap] = useState<Record<string, true>>({});

  // ✅ reported bank (local)
  const [reportedBankMap, setReportedBankMap] = useState<Record<string, true>>(
    {}
  );

  // modal for viewing all tels of a post
  const [telModalVisible, setTelModalVisible] = useState(false);
  const [telModalTels, setTelModalTels] = useState<string[]>([]);
  const [telModalTitle, setTelModalTitle] = useState<string>("");
  const [telModalPostId, setTelModalPostId] = useState<string | undefined>(
    undefined
  );

  // modal for viewing all bank accounts of a post
  const [bankModalVisible, setBankModalVisible] = useState(false);
  const [bankModalTitle, setBankModalTitle] = useState<string>("");
  const [bankModalPostId, setBankModalPostId] = useState<string | undefined>(
    undefined
  );
  const [bankModalList, setBankModalList] = useState<
    Array<{ bank_name?: string | null; seller_account?: string | null }>
  >([]);

  const canLoadMore = items.length < total;

  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ✅ sheets refs
  const blockSheetRef = useRef<BottomSheetBlockReportModalRef>(null);
  const reportBankSheetRef = useRef<BottomSheetReportBankModalRef>(null);

  // ✅ guard: require login before opening any sheet
  const requireLoginOrGo = useCallback(
    (e?: any) => {
      e?.stopPropagation?.();
      if (isLoggedIn) return true;

      // ปิด modal ที่อาจเปิดอยู่ เพื่อกัน UI ค้าง
      setTelModalVisible(false);
      setBankModalVisible(false);

      navigation.navigate("SignIn");
      return false;
    },
    [isLoggedIn, navigation]
  );

  const openUrl = useCallback(async (url?: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("เปิดลิงก์ไม่ได้", url);
    }
  }, []);

  // ====== load/save blocked tel ======
  const loadBlocked = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(BLOCKED_STORE_KEY);
      if (!raw) {
        setBlockedMap({});
        return;
      }
      const arr = JSON.parse(raw) as string[];
      const next: Record<string, true> = {};
      for (const t of arr || []) {
        const n = normalizeTel(t);
        if (n) next[n] = true;
      }
      setBlockedMap(next);
    } catch {}
  }, []);

  const persistBlocked = useCallback(async (m: Record<string, true>) => {
    try {
      const arr = Object.keys(m);
      await AsyncStorage.setItem(BLOCKED_STORE_KEY, JSON.stringify(arr));
    } catch {}
  }, []);

  // ====== load/save reported bank ======
  const loadReportedBank = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(REPORTED_BANK_STORE_KEY);
      if (!raw) {
        setReportedBankMap({});
        return;
      }
      const arr = JSON.parse(raw) as string[];
      const next: Record<string, true> = {};
      for (const a of arr || []) {
        const n = normalizeBankAccount(a);
        if (n) next[n] = true;
      }
      setReportedBankMap(next);
    } catch {}
  }, []);

  const persistReportedBank = useCallback(async (m: Record<string, true>) => {
    try {
      const arr = Object.keys(m);
      await AsyncStorage.setItem(
        REPORTED_BANK_STORE_KEY,
        JSON.stringify(arr)
      );
    } catch {}
  }, []);

  const isTelBlocked = useCallback(
    (tel: string) => {
      const n = normalizeTel(tel);
      return !!(n && blockedMap[n]);
    },
    [blockedMap]
  );

  const isBankReported = useCallback(
    (acc: string) => {
      const n = normalizeBankAccount(acc);
      return !!(n && reportedBankMap[n]);
    },
    [reportedBankMap]
  );

  const markBankReportedLocal = useCallback(
    (accNormalized: string) => {
      if (!accNormalized) return;
      setReportedBankMap((prev) => {
        const next = { ...prev, [accNormalized]: true };
        persistReportedBank(next);
        return next;
      });
    },
    [persistReportedBank]
  );

  // ✅ toggle tel block (no confirm; sheet confirm)
  const doToggleBlockNoConfirm = useCallback(
    async (telNormalized: string) => {
      if (!telNormalized) return;
      setBlockedMap((prev) => {
        const next = { ...prev };
        if (next[telNormalized]) delete next[telNormalized];
        else next[telNormalized] = true;
        persistBlocked(next);
        return next;
      });
    },
    [persistBlocked]
  );

  const openBlockSheet = useCallback(
    (
      e: any,
      telRaw: string,
      meta?: { postId?: string; title?: string; source?: "HOME" | "MODAL" }
    ) => {
      if (!requireLoginOrGo(e)) return;

      const tel = normalizeTel(telRaw);
      if (!tel) return;

      blockSheetRef.current?.open({
        tel,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
      });
    },
    [requireLoginOrGo]
  );

  // ✅ open report bank sheet (report-only)
  const openReportBankSheet = useCallback(
    (
      e: any,
      bankName: string | null | undefined,
      accountRaw: string,
      meta?: { postId?: string; title?: string; source?: "HOME" | "MODAL" }
    ) => {
      if (!requireLoginOrGo(e)) return;

      const acc = normalizeBankAccount(accountRaw);
      if (!acc) return;

      reportBankSheetRef.current?.open({
        bankName: bankName ?? null,
        account: acc,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
      });
    },
    [requireLoginOrGo]
  );

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
      await loadBlocked();
      await loadReportedBank();
    } catch (e: any) {
      Alert.alert("Load error", e?.message || "unknown");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loadBlocked, loadReportedBank]);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
    }, [loadFirst])
  );

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
    } catch {}
  }, []);

  const onOpenProfile = useCallback(
    (e: GestureResponderEvent, authorId?: string | null) => {
      e.stopPropagation?.();
      if (!authorId) return;
      navigation.navigate("Profile", { id: authorId });
    },
    [navigation]
  );

  const applyBookmarkToList = useCallback(
    (postId: string, isBookmarked: boolean) => {
      setItems((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, is_bookmarked: isBookmarked } : p
        )
      );
    },
    []
  );

  const toggleBookmark = useCallback(
    async (e: GestureResponderEvent, postId: string) => {
      e.stopPropagation?.();

      if (!isLoggedIn) {
        navigation.navigate("SignIn");
        return;
      }

      if (bookmarkBusyMap[postId]) return;

      const prevItem = items.find((x) => x.id === postId);
      const prevVal = !!prevItem?.is_bookmarked;

      setBookmarkBusyMap((m) => ({ ...m, [postId]: true }));
      applyBookmarkToList(postId, !prevVal);

      try {
        const { data } = await client.mutate({
          mutation: M_TOGGLE_BOOKMARK,
          variables: { postId },
        });

        const ok = !!data?.toggleBookmark?.isBookmarked;
        applyBookmarkToList(postId, ok);
      } catch (err: any) {
        applyBookmarkToList(postId, prevVal);
        Alert.alert(
          "Bookmark error",
          err?.message || "Please login first or try again."
        );
      } finally {
        setBookmarkBusyMap((m) => ({ ...m, [postId]: false }));
      }
    },
    [isLoggedIn, navigation, bookmarkBusyMap, items, applyBookmarkToList]
  );

  const openChatWithAuthor = useCallback(
    (e: GestureResponderEvent, authorId?: string | null) => {
      e.stopPropagation?.();
      if (!authorId) return;

      if (!isLoggedIn) {
        navigation.navigate("SignIn");
        return;
      }

      if (authorId === user?.id) return;

      navigation.navigate("Chat", { to: String(authorId) });
    },
    [isLoggedIn, navigation, user?.id]
  );

  const openAllTelsModal = useCallback(
    (title: string, tels: string[], postId?: string) => {
      setTelModalTitle(title || "เบอร์โทร");
      setTelModalTels(tels);
      setTelModalPostId(postId);
      setTelModalVisible(true);
    },
    []
  );

  const openAllBanksModal = useCallback(
    (
      title: string,
      list: Array<{ bank_name?: string | null; seller_account?: string | null }>,
      postId?: string
    ) => {
      setBankModalTitle(title || "บัญชีธนาคาร");
      setBankModalList(list || []);
      setBankModalPostId(postId);
      setBankModalVisible(true);
    },
    []
  );

  const renderPostItem = useCallback(
    ({ item }: { item: PostItem }) => {
      const ts = formatDateTime(item.created_at);
      const status = item.status || undefined;
      const sc = statusColor(status);
      const published = isFacebookPublished(item);

      const telListRaw = (item.tel_numbers || [])
        .map((t) => t.tel)
        .filter(Boolean);
      const telList = telListRaw
        .map((t) => normalizeTel(String(t)))
        .filter(Boolean);

      const bankRaw = (item.seller_accounts || []).filter(Boolean);
      const bankList = bankRaw
        .map((a) => ({
          bank_name: a.bank_name ?? null,
          seller_account: a.seller_account ?? null,
        }))
        .filter((x) => !!normalizeBankAccount(x.seller_account || ""));

      const onOpenPost = () => {
        navigation.navigate("PostView", {
          id: String(item?.id),
          currentUserId: user?.id,
        });
      };

      const authorName = item.author?.name?.trim() || "Unknown";
      const authorInitial = authorName?.[0]?.toUpperCase?.() || "?";
      const authorAvatar = item.author?.avatar
        ? String(item.author.avatar)
        : null;

      const isBookmarked = !!item.is_bookmarked;
      const bookmarkBusy = !!bookmarkBusyMap[item.id];

      const showChatBtn =
        !!item.author?.id &&
        !!user?.id &&
        String(item.author.id) !== String(user.id);
      // const showBookmarkBtn = showChatBtn;

      const INLINE_MAX_TELS = 3;
      const inlineTels = telList.slice(0, INLINE_MAX_TELS);
      const moreCount = Math.max(0, telList.length - INLINE_MAX_TELS);

      const INLINE_MAX_BANKS = 2;
      const inlineBanks = bankList.slice(0, INLINE_MAX_BANKS);
      const moreBanksCount = Math.max(0, bankList.length - INLINE_MAX_BANKS);

      return (
        <Pressable
          onPress={onOpenPost}
          android_ripple={{ color: "#222" }}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
        >
          {/* TOP */}
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

          {/* META + AUTHOR */}
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {ts}
            </Text>

            {item.author?.id ? (
              <Pressable
                onPress={(e) => onOpenProfile(e, item.author?.id)}
                style={({ pressed }) => [
                  styles.authorChip,
                  pressed && { opacity: 0.8 },
                ]}
                hitSlop={10}
              >
                {authorAvatar ? (
                  <Image
                    source={{ uri: authorAvatar }}
                    style={styles.authorAvatar}
                  />
                ) : (
                  <View style={styles.authorAvatarFallback}>
                    <Text style={styles.authorAvatarText}>
                      {authorInitial}
                    </Text>
                  </View>
                )}
                <Text style={styles.authorName} numberOfLines={1}>
                  {authorName}
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#9ca3af" />
              </Pressable>
            ) : (
              <Text style={[styles.meta, { marginLeft: 8 }]} numberOfLines={1}>
                • by {authorName}
              </Text>
            )}
          </View>

          {/* THUMB GRID */}
          <View style={{ marginTop: 10 }}>
            <ThumbGrid
              images={(item.images || []) as any}
              width={Dimensions.get("window").width - 24 - 20}
              height={160}
              radius={14}
              gap={6}
            />
          </View>

          {/* DETAIL */}
          {item.detail ? (
            <Text style={styles.detail} numberOfLines={4}>
              {item.detail}
            </Text>
          ) : null}

          {/* TEL chips */}
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Tel:</Text>

            {telList.length === 0 ? (
              <Text style={styles.infoValue} numberOfLines={1}>
                -
              </Text>
            ) : (
              <View style={styles.chipsWrap}>
                {inlineTels.map((tel) => {
                  const blocked = isTelBlocked(tel);
                  return (
                    <TouchableOpacity
                      key={tel}
                      onPress={(e: any) =>
                        openBlockSheet(e, tel, {
                          postId: item.id,
                          title: item.title ?? undefined,
                          source: "HOME",
                        })
                      }
                      activeOpacity={0.85}
                      style={[styles.telChip, blocked && styles.telChipBlocked]}
                    >
                      <Text style={styles.chipMainText} numberOfLines={1}>
                        {tel}
                      </Text>
                      <View style={styles.chipRight}>
                        <Ionicons
                          name={blocked ? "lock-closed" : "lock-open-outline"}
                          size={12}
                          color={blocked ? "#fff" : "#e5e7eb"}
                        />
                        <Text style={styles.chipRightText}>
                          {blocked ? "บล็อกแล้ว" : "บล็อก"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {moreCount > 0 ? (
                  <TouchableOpacity
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      openAllTelsModal(
                        item.title || "เบอร์โทรทั้งหมด",
                        telList,
                        item.id
                      );
                    }}
                    style={styles.moreChip}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.moreChipText}>+{moreCount}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {/* BANK chips (REPORT ONLY) */}
          <View style={styles.infoRow}>
            <Ionicons name="card-outline" size={14} color="#9ca3af" />
            <Text style={styles.infoLabel}>Bank:</Text>

            {bankList.length === 0 ? (
              <Text style={styles.infoValue} numberOfLines={1}>
                -
              </Text>
            ) : (
              <View style={styles.chipsWrap}>
                {inlineBanks.map((b, idx) => {
                  const acc = normalizeBankAccount(b.seller_account || "");
                  const reported = isBankReported(acc);
                  const label = `${b.bank_name || "Bank"}: ${acc}`;

                  return (
                    <TouchableOpacity
                      key={`${acc}-${idx}`}
                      onPress={(e: any) =>
                        openReportBankSheet(e, b.bank_name, acc, {
                          postId: item.id,
                          title: item.title ?? undefined,
                          source: "HOME",
                        })
                      }
                      activeOpacity={0.85}
                      style={[
                        styles.bankChip,
                        reported && styles.bankChipReported,
                      ]}
                    >
                      <Text style={styles.chipMainText} numberOfLines={1}>
                        {label}
                      </Text>

                      <View style={styles.chipRight}>
                        <Ionicons
                          name={
                            reported
                              ? "checkmark-circle"
                              : "megaphone-outline"
                          }
                          size={12}
                          color={reported ? "#34c759" : "#e5e7eb"}
                        />
                        <Text style={styles.chipRightText}>
                          {reported ? "รายงานแล้ว" : "รายงาน"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {moreBanksCount > 0 ? (
                  <TouchableOpacity
                    onPress={(e: any) => {
                      e?.stopPropagation?.();
                      openAllBanksModal(
                        item.title || "บัญชีธนาคารทั้งหมด",
                        bankList,
                        item.id
                      );
                    }}
                    style={styles.moreChip}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.moreChipText}>+{moreBanksCount}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {/* ACTIONS */}
          <View style={styles.actionsRow}>
            <IconButton
              icon="logo-facebook"
              disabled={!published}
              onPress={() => openUrl(item.fb_permalink_url)}
            />
            <IconButton
              icon="chatbox-outline"
              badge={item.comments_count || 0}
              onPress={onOpenPost}
            />
            <IconButton
              icon="share-social-outline"
              onPress={() => handleShare(item)}
            />

            {showChatBtn ? (
              <IconButton
                icon="chatbubbles-outline"
                onPress={(e) =>
                  openChatWithAuthor(e as any, item.author?.id)
                }
              />
            ) : null}

            <View style={{ flex: 1 }} />

            <IconButton
              icon={isBookmarked ? "bookmark" : "bookmark-outline"}
              onPress={(e) => toggleBookmark(e as any, item.id)}
              disabled={bookmarkBusy}
              active={isBookmarked}
              loading={bookmarkBusy}
            />
          </View>
        </Pressable>
      );
    },
    [
      navigation,
      user?.id,
      bookmarkBusyMap,
      isTelBlocked,
      isBankReported,
      openUrl,
      handleShare,
      openChatWithAuthor,
      toggleBookmark,
      openBlockSheet,
      openReportBankSheet,
      openAllTelsModal,
      openAllBanksModal,
    ]
  );

  const footer = useMemo(() => {
    if (!canLoadMore) return <View style={{ height: 24 }} />;
    return (
      <View style={styles.footer}>
        {loadingMore ? <ActivityIndicator /> : null}
        <Text style={styles.footerText}>
          {loadingMore ? "กำลังโหลดเพิ่ม..." : ""}
        </Text>
      </View>
    );
  }, [canLoadMore, loadingMore]);

  return (
    <View style={styles.container}>
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

      {/* ===== MODAL: show all tels ===== */}
      <Modal
        visible={telModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTelModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setTelModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {telModalTitle || "เบอร์โทร"}
              </Text>
              <TouchableOpacity onPress={() => setTelModalVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color="#e5e7eb" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalList}>
              {telModalTels.map((tel) => {
                const blocked = isTelBlocked(tel);
                return (
                  <View key={tel} style={styles.modalRow}>
                    <Text style={styles.modalTel} numberOfLines={1}>
                      {tel}
                    </Text>

                    <TouchableOpacity
                      onPress={(e: any) =>
                        openBlockSheet(e, tel, {
                          postId: telModalPostId,
                          title: telModalTitle,
                          source: "MODAL",
                        })
                      }
                      style={[styles.modalBtn, blocked && styles.modalBtnBlocked]}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={blocked ? "lock-closed" : "lock-open-outline"} size={14} color="#fff" />
                      <Text style={styles.modalBtnText}>{blocked ? "บล็อกแล้ว" : "บล็อก"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== MODAL: show all banks ===== */}
      <Modal
        visible={bankModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBankModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setBankModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {bankModalTitle || "บัญชีธนาคาร"}
              </Text>
              <TouchableOpacity onPress={() => setBankModalVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color="#e5e7eb" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalList}>
              {bankModalList.map((b, idx) => {
                const acc = normalizeBankAccount(b.seller_account || "");
                const reported = isBankReported(acc);
                const label = `${b.bank_name || "Bank"}: ${acc}`;

                return (
                  <View key={`${acc}-${idx}`} style={styles.modalRow}>
                    <Text style={styles.modalTel} numberOfLines={1}>
                      {label}
                    </Text>

                    <TouchableOpacity
                      onPress={(e: any) =>
                        openReportBankSheet(e, b.bank_name, acc, {
                          postId: bankModalPostId,
                          title: bankModalTitle,
                          source: "MODAL",
                        })
                      }
                      style={[styles.modalBtn, reported && styles.modalBtnReported]}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={reported ? "checkmark-circle" : "megaphone-outline"} size={14} color="#fff" />
                      <Text style={styles.modalBtnText}>{reported ? "รายงานแล้ว" : "รายงาน"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Bottom Sheet: Tel Block/Report ===== */}
      <BottomSheetBlockReportModal
        ref={blockSheetRef}
        isBlocked={(telNormalized) => !!blockedMap[telNormalized]}
        onBlock={async (telNormalized) => {
          // กันซ้ำชั้น: sheet เองก็จะถูกเปิดได้เฉพาะตอน login แล้ว
          setBlockedMap((prev) => {
            const next = { ...prev, [telNormalized]: true };
            persistBlocked(next);
            return next;
          });
        }}
        onUnblock={async (telNormalized) => {
          setBlockedMap((prev) => {
            const next = { ...prev };
            delete next[telNormalized];
            persistBlocked(next);
            return next;
          });
        }}
        onReport={async ({ tel, category, note, postId }) => {
          console.log("REPORT TEL", { tel, category, note, postId });
        }}
      />

      {/* ===== Bottom Sheet: Bank Report ONLY ===== */}
      <BottomSheetReportBankModal
        ref={reportBankSheetRef}
        isReported={(accNormalized) => !!reportedBankMap[accNormalized]}
        onMarkReported={(accNormalized) => markBankReportedLocal(accNormalized)}
        onReport={async ({ bankName, account, category, note, postId }) => {
          console.log("REPORT BANK", { bankName, account, category, note, postId });
        }}
      />
    </View>
  );
};

function IconButton(props: {
  icon: string;
  onPress: (e?: any) => void;
  disabled?: boolean;
  badge?: number;
  active?: boolean;
  loading?: boolean;
}) {
  const { icon, onPress, disabled, badge, active, loading } = props;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.iconBtn,
        active && styles.iconBtnActive,
        disabled && { opacity: 0.35 },
      ]}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Ionicons name={icon as any} size={18} color="#e5e7eb" />
      )}

      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badge > 99 ? "99+" : String(badge)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },

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

  metaRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { color: "#9ca3af", fontSize: 11, flex: 1 },

  authorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    maxWidth: 180,
  },
  authorAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#111" },
  authorAvatarFallback: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  authorName: { color: "#e5e7eb", fontSize: 11, fontWeight: "800" },

  detail: { marginTop: 10, color: "#e5e7eb", fontSize: 12, lineHeight: 16 },

  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  infoLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "800", marginTop: 2 },
  infoValue: { flex: 1, color: "#fff", fontSize: 12 },

  chipsWrap: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },

  telChip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  telChipBlocked: { borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.18)" },

  bankChip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  bankChipReported: { borderColor: "#34c759", backgroundColor: "rgba(52,199,89,0.14)" },

  chipMainText: { color: "#fff", fontSize: 12, fontWeight: "800", maxWidth: 220 },
  chipRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: "#2a2a35",
  },
  chipRightText: { color: "#e5e7eb", fontSize: 11, fontWeight: "900" },

  moreChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#15151c",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  moreChipText: { color: "#9ca3af", fontSize: 12, fontWeight: "900" },

  actionsRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
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
  iconBtnActive: { borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.18)" },

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

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 8 },
  emptyText: { color: "#6b7280", fontSize: 14 },

  footer: { paddingVertical: 16, alignItems: "center", gap: 8 },
  footerText: { color: "#9ca3af", fontSize: 12 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" },
  modalCard: { backgroundColor: "#111116", borderRadius: 16, borderWidth: 1, borderColor: "#2a2a35", padding: 12 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1f26",
  },
  modalTitle: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "900" },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  modalList: { paddingTop: 10, gap: 10 },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTel: { flex: 1, color: "#e5e7eb", fontSize: 13, fontWeight: "800" },
  modalBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#374151",
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  modalBtnBlocked: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  modalBtnReported: { backgroundColor: "#34c759", borderColor: "#34c759" },
  modalBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },
});