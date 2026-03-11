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
  Modal
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  loadBlockedTelMap,
  saveBlockedTelMap,
  loadReportedBankMap,
  saveReportedBankMap,
  getDeviceClientId,
  encodeBankCategoryIntoText,
  type StoredBlockedTelMap,
  type StoredBlockedTelEntry,
  type StoredReportedBankMap,
  type StoredReportedBankEntry,
} from "../lib/jachoeiLocalState";

import {
  useNavigation,
  useFocusEffect,
  useRoute,
  RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThumbGrid } from "../components/ThumbGrid";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import {
  Q_MY_BLOCKED_PHONE_KEYS,
  Q_MY_REPORTED_BANK_ACCOUNT_KEYS,
  useJachoeiStatusKeys,
} from "../hooks/useJachoeiStatusKeys";

import type { RootStackParamList, TabsParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthProvider";

import {
  BottomSheetBlockReportModal,
  BottomSheetBlockReportModalRef,
} from "../components/BottomSheetBlockReportModal";

import {
  BottomSheetReportBankModal,
  BottomSheetReportBankModalRef,
} from "../components/BottomSheetReportBankModal";

// =======================
// GraphQL
// =======================
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

const M_REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const M_UNREPORT_SCAM_BANK_ACCOUNT = gql`
  mutation UnreportScamBankAccount($input: UnreportScamBankAccountInput!) {
    unreportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
      tags
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
      updated_at
      is_deleted
      post_ids
      ctx
      tags
    }
  }
`;

const M_BLOCK_PHONE = gql`
  mutation BlockPhone($input: BlockPhoneInput!) {
    blockPhone(input: $input) {
      ok
      status {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
      }
    }
  }
`;

const M_UNBLOCK_PHONE = gql`
  mutation UnblockPhone($input: UnblockPhoneInput!) {
    unblockPhone(input: $input) {
      ok
      status {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
      }
    }
  }
`;

// =======================
// Types / Utils
// =======================
export type ReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

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

function genClientId() {
  // RN-safe UUID-ish (ไม่ใช้ uuidv4 เพื่อเลี่ยง crypto.getRandomValues)
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

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

type HomeRoute = RouteProp<TabsParamList, "HomeScreen">;


// const DEVICE_CLIENT_ID_KEY = "jachoei.device_client_id_v1";
// let _deviceClientIdCache: string | null = null;

// async function getDeviceClientId(): Promise<string> {
//   if (_deviceClientIdCache) return _deviceClientIdCache;

//   const existed = await AsyncStorage.getItem(DEVICE_CLIENT_ID_KEY);
//   if (existed) {
//     _deviceClientIdCache = existed;
//     return existed;
//   }

//   const created = genClientId();
//   await AsyncStorage.setItem(DEVICE_CLIENT_ID_KEY, created);
//   _deviceClientIdCache = created;
//   return created;
// }

// async function reportBankOnServer(args: {
//   bankName: string;
//   accountNorm: string;
//   note?: string | null;
// }) {
//   const client_id = await getDeviceClientId();

//   const input = {
//     bank_name: String(args.bankName || "").trim() || "UNKNOWN",
//     account: args.accountNorm,
//     note: args.note ?? null,
//     client_id,
//     device_model: Platform.OS,
//     os_version: String(Platform.Version),
//     app_version: "1.0.0",
//   };

//   const { data } = await client.mutate({
//     mutation: M_REPORT_SCAM_BANK_ACCOUNT,
//     variables: { input },
//   });

//   return data?.reportScamBankAccount;
// }

// async function unreportBankOnServer(args: {
//   bankName: string;
//   accountNorm: string;
//   reason?: string | null;
// }) {
//   const client_id = await getDeviceClientId();

//   const input = {
//     bank_name: String(args.bankName || "").trim() || "UNKNOWN",
//     account: args.accountNorm,
//     client_id,
//     device_model: Platform.OS,
//     os_version: String(Platform.Version),
//     app_version: "1.0.0",
//     reason: args.reason ?? null,
//   };

//   const { data } = await client.mutate({
//     mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
//     variables: { input },
//   });

//   return data?.unreportScamBankAccount;
// }


export const HomeScreen: React.FC = () => {
  const { isLoggedIn, user } = useAuth();
  const {
    isBlockedTel: isBlockedTelServer,
    isReportedBank: isReportedBankServer,
    refetchAll: refetchStatusKeys,
  } = useJachoeiStatusKeys({ enabled: isLoggedIn });

  const [items, setItems] = useState<PostItem[]>([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [q] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [bookmarkBusyMap, setBookmarkBusyMap] = useState<Record<string, boolean>>(
    {}
  );

  // ✅ blocked tel (local) — map: tel -> entry
  const [blockedMap, setBlockedMap] = useState<StoredBlockedTelMap>({});

  // ✅ reported bank (local) — map: account -> entry
  const [reportedBankMap, setReportedBankMap] = useState<StoredReportedBankMap>({});

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
  const route = useRoute<HomeRoute>();

  // ✅ sheets refs
  const blockSheetRef = useRef<BottomSheetBlockReportModalRef>(null);
  const reportBankSheetRef = useRef<BottomSheetReportBankModalRef>(null);

  // ✅ guard: require login before opening any sheet
  const requireLoginOrGo = useCallback(
    (e?: any) => {
      e?.stopPropagation?.();
      if (isLoggedIn) return true;

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
    const next = await loadBlockedTelMap();
    setBlockedMap(next);
  }, []);

  const persistBlocked = useCallback((m: StoredBlockedTelMap) => {
    void saveBlockedTelMap(m);
  }, []);

  // ====== load/save reported bank ======
  const loadReportedBank = useCallback(async () => {
    const next = await loadReportedBankMap();
    setReportedBankMap(next);
  }, []);

  const persistReportedBank = useCallback((m: StoredReportedBankMap) => {
    void saveReportedBankMap(m);
  }, []);

  const isTelBlocked = useCallback(
    (tel: string) => {
      return isBlockedTelServer(tel);
    },
    [isBlockedTelServer]
  );

  const isBankReported = useCallback(
    (acc: string) => {
      return isReportedBankServer(acc);
    },
    [isReportedBankServer]
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

      const entry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      blockSheetRef.current?.open({
        tel,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
        initialWantReport: entry?.wantReport,
        initialCategory: entry?.category,
        initialNote: entry?.note,
      });
    },
    [requireLoginOrGo, blockedMap]
  );

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

      const entry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;

      reportBankSheetRef.current?.open({
        bankName: bankName ?? null,
        account: acc,
        postId: meta?.postId,
        title: meta?.title,
        source: meta?.source ?? "HOME",
        initialCategory: entry?.category,
        initialNote: entry?.note,
      });
    },
    [requireLoginOrGo, reportedBankMap]
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
      await refetchStatusKeys();
    } catch (e: any) {
      Alert.alert("Load error", e?.message || "unknown");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loadBlocked, loadReportedBank, refetchStatusKeys]);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
    }, [loadFirst])
  );

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  // ✅ รับผล bookmark ที่ยิงมาจาก PostView (merge params)
  useEffect(() => {
    const p: any = route.params as any;
    if (!p?.bookmarkPing || !p?.bookmarkPostId) return;

    const postId = String(p.bookmarkPostId);
    const val = !!p.bookmarkValue;

    setItems((prev) =>
      prev.map((x) => (x.id === postId ? { ...x, is_bookmarked: val } : x))
    );

    // clear ping (กันยิงซ้ำ)
    navigation.setParams({
      bookmarkPing: undefined,
      bookmarkPostId: undefined,
      bookmarkValue: undefined,
    } as any);
  }, [route.params, navigation]);

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
        const { data } = await client.mutate<{
          toggleBookmark?: { status?: string | null; isBookmarked?: boolean | null } | null;
        }>({
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

      navigation.navigate("Chat", { to: String(authorId) } as any);
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

  // ✅ REPORT TEL -> ยิง reportScamPhone
  const reportTel = useCallback(
    async (payload: { tel: string; category?: ReportCategory | null; note?: string | null; postId?: string }) => {
      const tel = normalizeTel(payload.tel);
      if (!tel) {
        Alert.alert("เบอร์ไม่ถูกต้อง", "กรุณาลองใหม่");
        return;
      }

      const clientId = await getDeviceClientId();

      const input = {
        phone: tel,
        note: payload.note?.trim() ? String(payload.note).trim() : null,
        local_blocked: true,
        client_id: clientId,
        device_model: Platform.OS,
        os_version: String(Platform.Version),
        app_version: "1.0.0",
        category: payload.category ?? null,
      };

      try {
        const res = await client.mutate<{
          reportScamPhone:
            | {
                updated_at?: string | null;
                ctx?: unknown;
                tags?: string[] | null;
              }
            | null;
        }>({
          mutation: REPORT_SCAM_PHONE,
          variables: { input },
          refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
          awaitRefetchQueries: true,
        });

        Alert.alert("ส่งรายงานแล้ว", "ขอบคุณที่ช่วยกันทำให้ระบบแม่นขึ้น 🙏");
        return res.data?.reportScamPhone;
      } catch (e: any) {
        console.log("REPORT TEL ERROR", e?.message || e);
        Alert.alert("รายงานไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
        throw e;
      }
    },
    []
  );

  async function blockTelOnServer(args: { phone: string; note?: string | null; postId?: string | null }) {
    const input = {
      phone: args.phone,
      note: args.note ?? null,
      postId: args.postId ?? null,
    };

    const res = await client.mutate<{ blockPhone: { ok: boolean } }>({
      mutation: M_BLOCK_PHONE,
      variables: { input },
      refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
      awaitRefetchQueries: true,
    });

    return res.data?.blockPhone;
  }

  async function unblockTelOnServer(phone: string) {
    const input = { phone };
    const res = await client.mutate<{ unblockPhone: { ok: boolean } }>({
      mutation: M_UNBLOCK_PHONE,
      variables: { input },
      refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
      awaitRefetchQueries: true,
    });
    return res.data?.unblockPhone;
  }

  // ✅ Bank: report/unreport helpers
  async function reportBankOnServer(args: {
    bankName: string;
    accountNorm: string;
    note?: string | null;
  }) {
    const clientId = await getDeviceClientId();
    const input = {
      bank_name: String(args.bankName || "").trim() || "UNKNOWN",
      account: args.accountNorm,
      note: args.note ?? null,
      client_id: clientId,
      device_model: Platform.OS,
      os_version: String(Platform.Version),
      app_version: "1.0.0",
    };

    const { data } = await client.mutate<{
      reportScamBankAccount:
        | {
            bank_name?: string | null;
            updated_at?: string | null;
            ctx?: unknown;
            tags?: string[] | null;
          }
        | null;
    }>({
      mutation: M_REPORT_SCAM_BANK_ACCOUNT,
      variables: { input },
      refetchQueries: [{ query: Q_MY_REPORTED_BANK_ACCOUNT_KEYS }],
      awaitRefetchQueries: true,
    });

    return data?.reportScamBankAccount;
  }

  async function unreportBankOnServer(args: {
    bankName: string;
    accountNorm: string;
    reason?: string | null;
  }) {
    const clientId = await getDeviceClientId();
    const input = {
      bank_name: String(args.bankName || "").trim() || "UNKNOWN",
      account: args.accountNorm,
      client_id: clientId,
      device_model: Platform.OS,
      os_version: String(Platform.Version),
      app_version: "1.0.0",
      reason: args.reason ?? null,
    };

    const { data } = await client.mutate<{
      unreportScamBankAccount:
        | {
            bank_name?: string | null;
            updated_at?: string | null;
            ctx?: unknown;
            tags?: string[] | null;
          }
        | null;
    }>({
      mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
      variables: { input },
      refetchQueries: [{ query: Q_MY_REPORTED_BANK_ACCOUNT_KEYS }],
      awaitRefetchQueries: true,
    });

    return data?.unreportScamBankAccount;
  }

  const performTelConfirm = useCallback(
    async (value: { tel: string; wantReport: boolean; category: ReportCategory; note: string; postId?: string }) => {
      const tel = normalizeTel(value.tel);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;

      const optimisticEntry: StoredBlockedTelEntry = {
        wantReport: !!value.wantReport,
        category: value.wantReport ? value.category : undefined,
        note: value.wantReport ? value.note : "",
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev, [tel]: optimisticEntry };
        persistBlocked(next);
        return next;
      });

      try {
        // 1) Block on server (source of truth)
        await blockTelOnServer({
          phone: tel,
          note: value.note?.trim() ? value.note.trim() : null,
          postId: value.postId ? String(value.postId) : null,
        });

        // 2) Optional: also submit a scam report
        const payload = value.wantReport
          ? await reportTel({
              tel,
              category: value.category,
              note: value.note,
              postId: value.postId,
            })
          : null;

        if (payload) {
          setBlockedMap((prev) => {
            const next: StoredBlockedTelMap = {
              ...prev,
              [tel]: {
                ...optimisticEntry,
                blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistBlocked(next);
            return next;
          });
        }
      } catch {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev };
          if (prevEntry) next[tel] = prevEntry;
          else delete next[tel];
          persistBlocked(next);
          return next;
        });
      }
    },
    [blockedMap, persistBlocked, reportTel]
  );

  const performTelUndo = useCallback(
    async (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      const prevEntry = blockedMap[tel] as StoredBlockedTelEntry | undefined;
      if (!prevEntry) return;

      setBlockedMap((prev) => {
        const next: StoredBlockedTelMap = { ...prev };
        delete next[tel];
        persistBlocked(next);
        return next;
      });

      try {
        await unblockTelOnServer(tel);
        Alert.alert("ยกเลิกบล็อกแล้ว", tel);
      } catch (e: any) {
        setBlockedMap((prev) => {
          const next: StoredBlockedTelMap = { ...prev, [tel]: prevEntry };
          persistBlocked(next);
          return next;
        });
        Alert.alert("Unblock ไม่สำเร็จ", e?.message || "กรุณาลองใหม่");
      }
    },
    [blockedMap, persistBlocked]
  );

  const performBankConfirm = useCallback(
    async (value: {
      bankName: string | null;
      account: string;
      category: StoredReportedBankEntry["category"];
      note: string;
    }) => {
      const acc = normalizeBankAccount(value.account);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      const wasReported = !!prevEntry;

      const optimisticEntry: StoredReportedBankEntry = {
        bank_name: value.bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev, [acc]: optimisticEntry };
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(value.bankName || "").trim() || "UNKNOWN";
      const noteEncoded = encodeBankCategoryIntoText(value.category, value.note);

      try {
        const payload = await reportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          note: noteEncoded,
        });

        if (payload) {
          setReportedBankMap((prev) => {
            const next: StoredReportedBankMap = {
              ...prev,
              [acc]: {
                ...optimisticEntry,
                bank_name: payload.bank_name ?? optimisticEntry.bank_name,
                reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
                ctx: payload.ctx ?? optimisticEntry.ctx,
                tags: payload.tags ?? optimisticEntry.tags,
              },
            };
            persistReportedBank(next);
            return next;
          });
        }

        Alert.alert("สำเร็จ", wasReported ? "อัปเดตรายงานแล้ว" : "รายงานบัญชีเรียบร้อยแล้ว");
      } catch (err: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev };
          if (prevEntry) next[acc] = prevEntry;
          else delete next[acc];
          persistReportedBank(next);
          return next;
        });

        Alert.alert("ทำรายการไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank]
  );

  const performBankUndo = useCallback(
    async (bankName: string | null, accountRaw: string) => {
      const acc = normalizeBankAccount(accountRaw);
      if (!acc) {
        Alert.alert("เลขบัญชีไม่ถูกต้อง");
        return;
      }

      const prevEntry = reportedBankMap[acc] as StoredReportedBankEntry | undefined;
      if (!prevEntry) return;

      setReportedBankMap((prev) => {
        const next: StoredReportedBankMap = { ...prev };
        delete next[acc];
        persistReportedBank(next);
        return next;
      });

      const bankNameSafe = String(bankName || "").trim() || "UNKNOWN";
      const reasonEncoded = encodeBankCategoryIntoText(prevEntry.category, prevEntry.note ?? null);

      try {
        await unreportBankOnServer({
          bankName: bankNameSafe,
          accountNorm: acc,
          reason: reasonEncoded,
        });

        Alert.alert("สำเร็จ", "ยกเลิกรายงานบัญชีแล้ว");
      } catch (err: any) {
        setReportedBankMap((prev) => {
          const next: StoredReportedBankMap = { ...prev, [acc]: prevEntry };
          persistReportedBank(next);
          return next;
        });

        Alert.alert("ทำรายการไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      }
    },
    [reportedBankMap, persistReportedBank]
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
        } as any);
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

          {/* BANK chips (REPORT/UNREPORT) */}
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
                          name={reported ? "close-circle" : "megaphone-outline"}
                          size={12}
                          color={reported ? "#ef4444" : "#e5e7eb"}
                        />
                        <Text style={[styles.chipRightText, reported && { color: "#ef4444" }]}>
                          {reported ? "ยกเลิกรายงาน" : "รายงาน"}
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
                onPress={(e) => openChatWithAuthor(e as any, item.author?.id)}
              />
            ) : null}

            <View style={{ flex: 1 }} />

            {showChatBtn ? (
              <IconButton
                icon={isBookmarked ? "bookmark" : "bookmark-outline"}
                onPress={(e) => toggleBookmark(e as any, item.id)}
                disabled={bookmarkBusy}
                active={isBookmarked}
                loading={bookmarkBusy}
              />
            ) : null}
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
          <RefreshControl
            refreshing={loading && page === 1}
            onRefresh={onRefresh}
          />
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
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTelModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {telModalTitle || "เบอร์โทร"}
              </Text>
              <TouchableOpacity
                onPress={() => setTelModalVisible(false)}
                style={styles.modalClose}
              >
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
                      style={[
                        styles.modalBtn,
                        blocked && styles.modalBtnBlocked,
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={blocked ? "lock-closed" : "lock-open-outline"}
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.modalBtnText}>
                        {blocked ? "บล็อกแล้ว" : "บล็อก"}
                      </Text>
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
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setBankModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {bankModalTitle || "บัญชีธนาคาร"}
              </Text>
              <TouchableOpacity
                onPress={() => setBankModalVisible(false)}
                style={styles.modalClose}
              >
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
                      style={[
                        styles.modalBtn,
                        reported && styles.modalBtnReported,
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={reported ? "close-circle" : "megaphone-outline"}
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.modalBtnText}>
                        {reported ? "ยกเลิกรายงาน" : "รายงาน"}
                      </Text>
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
        isBlocked={(telNormalized) => isTelBlocked(telNormalized)}
        onConfirm={async ({ tel, wantReport, category, note, postId }) => {
          await performTelConfirm({ tel, wantReport, category, note, postId });
        }}
        onUndo={async ({ tel }) => {
          await performTelUndo(tel);
        }}
      />

      {/* ===== Bottom Sheet: Bank Report / Unreport ===== */}
     <BottomSheetReportBankModal
        ref={reportBankSheetRef}
        isReported={(accNormalized) => isBankReported(accNormalized)}
        onConfirm={async ({ bankName, account, category, note }) => {
          await performBankConfirm({ bankName, account, category, note });
        }}
        onUndo={async ({ bankName, account }) => {
          await performBankUndo(bankName, account);
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