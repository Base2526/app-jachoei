// src/screens/PostViewScreen.tsx
import React, { useMemo, useLayoutEffect, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  Pressable,
  Share,
  Alert,
  Linking,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import Clipboard from "@react-native-clipboard/clipboard";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import ImageViewing from "react-native-image-viewing";
import { gql } from "@apollo/client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { RootStackParamList } from "../navigation/types";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import { CommentsSection } from "../components/comments/CommentsSection";
import { useAuth } from "../auth/AuthProvider";

import {
  BottomSheetBlockReportModal,
  BottomSheetBlockReportModalRef,
} from "../components/BottomSheetBlockReportModal";

import {
  BottomSheetReportBankModal,
  BottomSheetReportBankModalRef,
} from "../components/BottomSheetReportBankModal";

/* =======================
 * GraphQL
 * ======================= */

const Q_POST = gql`
  query ($id: ID!) {
    post(id: $id) {
      detail
      transfer_amount
      transfer_date
      updated_at
      website
      is_bookmarked
      tel_numbers {
        id
        tel
      }
      status
      seller_accounts {
        bank_id
        bank_name
        id
        seller_account
      }
      province_name
      province_id
      title
      images {
        id
        url
      }
      id_card
      id
      first_last_name
      created_at
      author {
        avatar
        created_at
        email
        id
        name
        phone
        role
      }
      fb_permalink_url
      fb_published_at
      fb_status
      fb_social_post_id
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

const DELETE_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

// --- New GraphQL mutations for report/unreport ---
const M_REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input){
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
    unreportScamBankAccount(input: $input){
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
    reportScamPhone(input: $input){
      phone
      report_count
      last_report_at
      risk_level
      updated_at
      is_deleted
      post_ids
      ctx
    }
  }
`;

const UNBLOCK_SCAM_PHONE = gql`
  mutation UnblockScamPhone($input: UnblockScamPhoneInput!) {
    unblockScamPhone(input: $input){
      phone
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

/* =======================
 * Types
 * ======================= */

export type PostRecord = {
  id: string;
  title?: string;
  detail?: string;
  created_at?: string;

  first_last_name?: string;
  id_card?: string;
  transfer_amount?: number;
  transfer_date?: string;
  website?: string;
  province_name?: string;

  tel_numbers?: { id: string; tel: string }[];
  seller_accounts?: {
    id: string;
    bank_name?: string;
    seller_account?: string;
  }[];

  images?: { id: string; url: string }[];

  fb_status?: string;
  fb_permalink_url?: string;

  author?: { id: string; name?: string | null } | null;
  is_bookmarked?: boolean;
};

type Props = NativeStackScreenProps<RootStackParamList, "PostView">;

/* =======================
 * Local Storage (same as Home)
 * ======================= */
const BLOCKED_STORE_KEY = "jachoei.blocked_tel_v1";
const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";
const DEVICE_CLIENT_ID_KEY = "jachoei.device_client_id_v1";

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

function genClientId() {
  // UUID-ish, no uuid lib
  const rand = () => Math.random().toString(16).slice(2);
  return (
    rand() + rand() + Date.now().toString(16) + rand()
  ).slice(0, 32);
}

async function getDeviceClientId() {
  let id = await AsyncStorage.getItem(DEVICE_CLIENT_ID_KEY);
  if (id && typeof id === "string" && id.length > 0) return id;
  id = genClientId();
  await AsyncStorage.setItem(DEVICE_CLIENT_ID_KEY, id);
  return id;
}

/* =======================
 * Screen
 * ======================= */

export const PostViewScreen: React.FC<Props> = ({ route, navigation }) => {
  const { id, currentUserId } = route.params;
  const { isLoggedIn, user } = useAuth();

  const [post, setPost] = React.useState<PostRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // bookmark busy
  const [bookmarkBusy, setBookmarkBusy] = React.useState(false);

  // images preview
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);

  // ✅ blocked tel (local)
  const [blockedMap, setBlockedMap] = React.useState<Record<string, true>>({});
  // ✅ reported bank (local)
  const [reportedBankMap, setReportedBankMap] = React.useState<Record<string, true>>({});

  // ✅ sheets refs
  const blockSheetRef = useRef<BottomSheetBlockReportModalRef>(null);
  const reportBankSheetRef = useRef<BottomSheetReportBankModalRef>(null);

    // --- Device info helpers ---
    const deviceModel = typeof navigator !== "undefined" && (navigator as any).userAgent ? (navigator as any).userAgent : "unknown";
    const osVersion = typeof navigator !== "undefined" && (navigator as any).platform ? (navigator as any).platform : "unknown";
    const appVersion = ENV.appVersion || "unknown";

  const previewImages = React.useMemo(
    () =>
      (post?.images || []).map((img) => ({
        uri: `${ENV.apiBase}${img.url}`,
      })),
    [post?.images]
  );

  /* =======================
   * Load post by id
   * ======================= */
  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await client.query({
        query: Q_POST,
        variables: { id },
        fetchPolicy: "network-only",
      });

      const p = data?.post ?? null;
      setPost(p);
    } catch (e: any) {
      setError(e?.message || "โหลดข้อมูลโพสต์ไม่สำเร็จ");
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  /* =======================
   * ✅ Load local states (blocked/report)
   * ======================= */
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
      await AsyncStorage.setItem(REPORTED_BANK_STORE_KEY, JSON.stringify(arr));
    } catch {}
  }, []);

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  useEffect(() => {
    loadBlocked();
    loadReportedBank();
  }, [loadBlocked, loadReportedBank]);

  /* =======================
   * Helpers
   * ======================= */

    // --- Bank report/unreport ---
    const reportBankOnServer = useCallback(
      async (bankName: string | null | undefined, accountRaw: string, note: string) => {
        const acc = normalizeBankAccount(accountRaw);
        if (!acc) throw new Error("บัญชีไม่ถูกต้อง");
        const client_id = await getDeviceClientId();
        const input = {
          bank_name: bankName || null,
          account: acc,
          note,
          client_id,
          device_model: deviceModel,
          os_version: osVersion,
          app_version: appVersion,
        };
        const { data } = await client.mutate({
          mutation: M_REPORT_SCAM_BANK_ACCOUNT,
          variables: { input },
        });
        return !!data?.reportScamBankAccount;
      },
      [deviceModel, osVersion, appVersion]
    );

    const unreportBankOnServer = useCallback(
      async (bankName: string | null | undefined, accountRaw: string, reason?: string) => {
        const acc = normalizeBankAccount(accountRaw);
        if (!acc) throw new Error("บัญชีไม่ถูกต้อง");
        const client_id = await getDeviceClientId();
        const input: any = {
          bank_name: bankName || null,
          account: acc,
          client_id,
          device_model: deviceModel,
          os_version: osVersion,
          app_version: appVersion,
        };
        if (reason) input.reason = reason;
        const { data } = await client.mutate({
          mutation: M_UNREPORT_SCAM_BANK_ACCOUNT,
          variables: { input },
        });
        return !!data?.unreportScamBankAccount;
      },
      [deviceModel, osVersion, appVersion]
    );

    // --- Tel report/unblock ---
    const reportTel = useCallback(
      async ({ tel, note, category, postId }: { tel: string; note: string; category: string; postId?: string }) => {
        const phone = normalizeTel(tel);
        if (!phone) throw new Error("เบอร์ไม่ถูกต้อง");
        const client_id = await getDeviceClientId();
        const input = {
          phone,
          note,
          local_blocked: true,
          client_id,
          device_model: deviceModel,
          os_version: osVersion,
          app_version: appVersion,
          category,
        };
        const { data } = await client.mutate({
          mutation: REPORT_SCAM_PHONE,
          variables: { input },
        });
        return !!data?.reportScamPhone;
      },
      [deviceModel, osVersion, appVersion]
    );

    const unblockTelOnServer = useCallback(
      async (tel: string) => {
        const phone = normalizeTel(tel);
        if (!phone) throw new Error("เบอร์ไม่ถูกต้อง");
        const client_id = await getDeviceClientId();
        const input = {
          phone,
          client_id,
          device_model: deviceModel,
          os_version: osVersion,
          app_version: appVersion,
        };
        const { data } = await client.mutate({
          mutation: UNBLOCK_SCAM_PHONE,
          variables: { input },
        });

        console.log("unblockTelOnServer", { input, data });
        return !!data?.unblockScamPhone;
      },
      [deviceModel, osVersion, appVersion]
    );

  const isOwner = !!currentUserId && currentUserId === post?.author?.id;

  const isFbPublished =
    String(post?.fb_status || "").toUpperCase() === "PUBLISHED" &&
    !!post?.fb_permalink_url;

  const isBookmarked = !!post?.is_bookmarked;

  // ✅ เงื่อนไข chat เหมือน Home
  const showChatBtn = useMemo(() => {
    const authorId = post?.author?.id;
    return !!authorId && !!user?.id && String(authorId) !== String(user.id);
  }, [post?.author?.id, user?.id]);

  const sharePayload = useMemo(() => {
    const url = `https://jachoei.com/post/${id}`;
    const title = post?.title || "จ่าเฉย (JACHOEI)";
    const text = post?.detail
      ? `${title}\n\n${String(post.detail).slice(0, 180)}${
          String(post.detail).length > 180 ? "..." : ""
        }`
      : title;
    return { url, title, message: text };
  }, [post?.title, post?.detail, id]);

  const openUrl = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) {
        Alert.alert("เปิดลิงก์ไม่ได้", url);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      console.warn("openUrl error", e);
      Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถเปิดลิงก์ได้");
    }
  }, []);

  const onShare = useCallback(async () => {
    try {
      await Share.share(sharePayload);
    } catch (e) {
      console.warn("share error", e);
    }
  }, [sharePayload]);

  const copyText = useCallback((v?: string) => {
    if (!v) return;
    Clipboard.setString(String(v));
    Alert.alert("คัดลอกแล้ว");
  }, []);

  // ✅ require login guard
  const requireLoginOrGo = useCallback(() => {
    if (isLoggedIn) return true;
    navigation.navigate("SignIn");
    return false;
  }, [isLoggedIn, navigation]);

  const isTelBlocked = useCallback(
    (telRaw: string) => {
      const n = normalizeTel(telRaw);
      return !!(n && blockedMap[n]);
    },
    [blockedMap]
  );

  const isBankReported = useCallback(
    (accRaw: string) => {
      const n = normalizeBankAccount(accRaw);
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

  // ✅ open tel bottom sheet
  const openBlockSheet = useCallback(
    (telRaw: string) => {
      if (!requireLoginOrGo()) return;

      const tel = normalizeTel(telRaw);
      if (!tel) return;

      blockSheetRef.current?.open({
        tel,
        postId: String(post?.id || ""),
        title: post?.title || undefined,
        source: "POST_VIEW" as any,
      });
    },
    [requireLoginOrGo, post?.id, post?.title]
  );

  // ✅ open bank bottom sheet
  const openReportBankSheet = useCallback(
    (bankName: string | null | undefined, accountRaw: string) => {
      if (!requireLoginOrGo()) return;

      const acc = normalizeBankAccount(accountRaw);
      if (!acc) return;

      reportBankSheetRef.current?.open({
        bankName: bankName ?? null,
        account: acc,
        postId: String(post?.id || ""),
        title: post?.title || undefined,
        source: "POST_VIEW" as any,
      });
    },
    [requireLoginOrGo, post?.id, post?.title]
  );

  // ✅ open chat (เหมือน Home)
  const openChatWithAuthor = useCallback(
    (authorId?: string | null) => {
      if (!authorId) return;
      if (!requireLoginOrGo()) return;
      if (String(authorId) === String(user?.id)) return;
      navigation.navigate("Chat", { to: String(authorId) } as any);
    },
    [navigation, requireLoginOrGo, user?.id]
  );

  /* =======================
   * ✅ Bookmark toggle
   * ======================= */
  const onToggleBookmark = useCallback(async () => {
    if (!post?.id) return;

    if (!isLoggedIn) {
      navigation.navigate("SignIn");
      return;
    }

    if (bookmarkBusy) return;

    const prevVal = !!post.is_bookmarked;

    // optimistic
    setBookmarkBusy(true);
    setPost((p) => (p ? { ...p, is_bookmarked: !prevVal } : p));

    try {
      const { data } = await client.mutate({
        mutation: M_TOGGLE_BOOKMARK,
        variables: { postId: String(post.id) },
      });

      const ok = !!data?.toggleBookmark?.isBookmarked;
      setPost((p) => (p ? { ...p, is_bookmarked: ok } : p));

      // ✅ ส่งผลกลับ Home (แก้ปัญหากลับไปแล้ว list ไม่อัปเดต)
      navigation.navigate({
        name: "Home" as any,
        params: {
          bookmarkPostId: String(post.id),
          bookmarkValue: ok,
          bookmarkPing: Date.now(),
        },
        merge: true,
      } as any);
    } catch (e: any) {
      // rollback
      setPost((p) => (p ? { ...p, is_bookmarked: prevVal } : p));
      Alert.alert("Bookmark error", e?.message || "Please login first or try again.");
    } finally {
      setBookmarkBusy(false);
    }
  }, [post?.id, post?.is_bookmarked, isLoggedIn, navigation, bookmarkBusy]);

  /* =======================
   * Delete
   * ======================= */

  const handleDelete = useCallback(async () => {
    Alert.alert("ลบโพสต์", "ต้องการลบโพสต์นี้ใช่ไหม?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบ",
        style: "destructive",
        onPress: async () => {
          try {
            const { data } = await client.mutate({
              mutation: DELETE_POST,
              variables: { id },
            });

            if (data?.deletePost) {
              Alert.alert("สำเร็จ", "ลบโพสต์เรียบร้อย");
              navigation.goBack();
            } else {
              Alert.alert("ไม่สำเร็จ", "ลบไม่สำเร็จ");
            }
          } catch (e: any) {
            Alert.alert("เกิดข้อผิดพลาด", e?.message || "Delete error");
          }
        },
      },
    ]);
  }, [id, navigation]);

  /* =======================
   * ✅ Navigation header
   * ======================= */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "",
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerRight: () => (
        <View style={styles.navActions}>
          {showChatBtn ? (
            <Pressable onPress={() => openChatWithAuthor(post?.author?.id)} hitSlop={10} style={styles.navBtn}>
              <Ionicons name="chatbubbles-outline" size={20} color="#fff" />
            </Pressable>
          ) : null}

          {!isOwner ? (
            <Pressable
              onPress={onToggleBookmark}
              hitSlop={10}
              disabled={bookmarkBusy}
              style={({ pressed }) => [
                styles.navBtn,
                pressed && { opacity: 0.75 },
                bookmarkBusy && { opacity: 0.4 },
              ]}
            >
              {bookmarkBusy ? (
                <ActivityIndicator />
              ) : (
                <Ionicons
                  name={isBookmarked ? "bookmark" : "bookmark-outline"}
                  size={22}
                  color={isBookmarked ? "#60a5fa" : "#fff"}
                />
              )}
            </Pressable>
          ) : null}

          {isFbPublished ? (
            <Pressable
              onPress={() => {
                Alert.alert("Open Facebook", "ต้องการเปิดโพสต์บน Facebook ไหม?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Open", onPress: () => openUrl(post?.fb_permalink_url) },
                ]);
              }}
              hitSlop={10}
              style={styles.navBtn}
            >
              <Ionicons name="logo-facebook" size={22} color="#1877f2" />
            </Pressable>
          ) : null}

          <Pressable onPress={onShare} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </Pressable>

          {isOwner ? (
            <>
              <Pressable
                onPress={() => navigation.navigate("PostForm", { id: String(post?.id) } as any)}
                hitSlop={10}
                style={styles.navBtn}
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
              </Pressable>

              <Pressable onPress={handleDelete} hitSlop={10} style={styles.navBtn}>
                <Ionicons name="trash-outline" size={22} color="#ff3b30" />
              </Pressable>
            </>
          ) : null}
        </View>
      ),
    });
  }, [
    navigation,
    post?.id,
    post?.author?.id,
    post?.fb_permalink_url,
    isOwner,
    isFbPublished,
    isBookmarked,
    bookmarkBusy,
    showChatBtn,
    openChatWithAuthor,
    onToggleBookmark,
    onShare,
    openUrl,
    handleDelete,
  ]);

  /* =======================
   * Render list items
   * ======================= */

  const renderTelItem = useCallback(
    ({ item, index }: { item: { id: string; tel: string }; index: number }) => {
      const tel = item.tel || "";
      const blocked = isTelBlocked(tel);

      return (
        <View style={styles.rowItem}>
          <Text style={styles.rowIndex}>{index + 1}.</Text>

          <Pressable onPress={() => copyText(tel)} hitSlop={10} style={{ flex: 1 }}>
            <Text style={styles.rowText}>{tel || "-"}</Text>
            {tel ? <Text style={styles.copyHintSmall}>แตะเพื่อคัดลอก</Text> : null}
          </Pressable>

          <TouchableOpacity
            onPress={() => openBlockSheet(tel)}
            activeOpacity={0.85}
            style={[styles.actionPill, blocked && styles.actionPillDanger]}
          >
            <Ionicons name={blocked ? "lock-closed" : "lock-open-outline"} size={14} color="#fff" />
            <Text style={styles.actionPillText}>{blocked ? "บล็อกแล้ว" : "บล็อก"}</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [copyText, isTelBlocked, openBlockSheet]
  );

  const renderAccountItem = useCallback(
    ({
      item,
      index,
    }: {
      item: { id: string; bank_name?: string; seller_account?: string };
      index: number;
    }) => {
      const accRaw = item.seller_account || "";
      const acc = normalizeBankAccount(accRaw);
      const reported = isBankReported(acc);

      return (
        <View style={styles.rowItem}>
          <Text style={styles.rowIndex}>{index + 1}.</Text>

          <View style={{ flex: 1 }}>
            <Text style={styles.rowText}>{item.bank_name || "-"}</Text>
            <Pressable onPress={() => copyText(accRaw)}>
              <Text style={styles.copyText}>{accRaw || "-"}</Text>
            </Pressable>
          </View>

          <TouchableOpacity
            onPress={() => openReportBankSheet(item.bank_name, accRaw)}
            activeOpacity={0.85}
            style={[styles.actionPill, reported && styles.actionPillOk]}
          >
            <Ionicons name={reported ? "checkmark-circle" : "megaphone-outline"} size={14} color="#fff" />
            <Text style={styles.actionPillText}>{reported ? "รายงานแล้ว" : "รายงาน"}</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [copyText, isBankReported, openReportBankSheet]
  );

  /* =======================
   * UI: Loading / Error
   * ======================= */

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={[styles.emptyText, { marginTop: 10 }]}>กำลังโหลดข้อมูลโพสต์…</Text>
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || "ไม่พบโพสต์"}</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <Pressable style={styles.btnPrimary} onPress={fetchPost}>
            <Text style={styles.btnPrimaryText}>ลองใหม่</Text>
          </Pressable>

          <Pressable style={styles.btnGhost} onPress={() => navigation.goBack()}>
            <Text style={styles.btnGhostText}>กลับ</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* =======================
   * UI: Post view
   * ======================= */

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }}>
      <Text style={styles.bodyTitle} numberOfLines={3}>
        {post.title || "-"}
      </Text>

      {/* ===== BASIC INFO ===== */}
      <InfoRow label="รายละเอียด" value={post.detail} />
      <InfoRow label="ชื่อผู้ขาย" value={post.first_last_name} />
      <InfoRow label="เลขบัตร" value={post.id_card} copyable onCopy={copyText} />
      <InfoRow
        label="ยอดโอน"
        value={
          post.transfer_amount != null
            ? Number(post.transfer_amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
            : "-"
        }
      />
      <InfoRow label="วันที่โอน" value={post.transfer_date} />
      <InfoRow label="เว็บไซต์" value={post.website} copyable onCopy={copyText} />
      <InfoRow label="จังหวัด" value={post.province_name} />

      {/* ===== TEL NUMBERS ===== */}
      {!!post.tel_numbers?.length && (
        <>
          <SectionTitle title="เบอร์โทรศัพท์ / ไอดี" />
          <FlatList
            data={post.tel_numbers}
            keyExtractor={(i) => i.id}
            renderItem={renderTelItem}
            scrollEnabled={false}
          />
        </>
      )}

      {/* ===== SELLER ACCOUNTS ===== */}
      {!!post.seller_accounts?.length && (
        <>
          <SectionTitle title="บัญชีคนขาย" />
          <FlatList
            data={post.seller_accounts}
            keyExtractor={(i) => i.id}
            renderItem={renderAccountItem}
            scrollEnabled={false}
          />
        </>
      )}

      {/* ===== IMAGES ===== */}
      {!!post.images?.length && (
        <>
          <SectionTitle title="รูปภาพแนบ" />

          <View style={styles.imageGrid}>
            {post.images.map((img, index) => (
              <Pressable
                key={String(img.id)}
                style={styles.imageWrap}
                onPress={() => {
                  setPreviewIndex(index);
                  setPreviewVisible(true);
                }}
              >
                <Image source={{ uri: `${ENV.apiBase}${img.url}` }} style={styles.image} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.hint}>แตะรูปเพื่อดูแบบเต็มจอ</Text>

          <ImageViewing
            images={previewImages}
            imageIndex={previewIndex}
            visible={previewVisible}
            onRequestClose={() => setPreviewVisible(false)}
            swipeToCloseEnabled
            doubleTapToZoomEnabled
          />
        </>
      )}

      {/* ===== COMMENTS ===== */}
      <View style={[styles.commentsCol, { marginTop: 0 }]}>
        <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
          <Text style={styles.sectionTitle}>ความคิดเห็น</Text>
          <View style={styles.dividerLine} />
        </View>

        <CommentsSection postId={String(post.id)} currentUserId={currentUserId} />
      </View>

      {/* ===== Bottom Sheet: Tel Block/Report ===== */}
      <BottomSheetBlockReportModal
        ref={blockSheetRef}
        isBlocked={(telNormalized) => !!blockedMap[telNormalized]}
          onBlock={async (telNormalized) => {
            setBlockedMap((prev) => {
              const next = { ...prev, [telNormalized]: true };
              persistBlocked(next);
              return next;
            });
          }}
          onUnblock={async (telNormalized) => {
            try {
              const ok = await unblockTelOnServer(telNormalized);
              if (ok) {
                setBlockedMap((prev) => {
                  const next = { ...prev };
                  delete next[telNormalized];
                  persistBlocked(next);
                  return next;
                });

                Alert.alert("ปลดรายงานสำเร็จ", "เบอร์นี้ถูกปลดรายงานแล้ว");
              } else {
                Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถปลดบล็อกเบอร์ได้");
              }
            } catch (e: any) {
              Alert.alert("เกิดข้อผิดพลาด", e?.message || "Unblock error");
            }
          }}
          onReport={async ({ tel, category, note, postId }) => {
            try {
              await reportTel({ tel, category, note, postId });
              Alert.alert("รายงานสำเร็จ", "ขอบคุณที่แจ้งเบอร์");
            } catch (e: any) {
              Alert.alert("เกิดข้อผิดพลาด", e?.message || "Report error");
            }
          }}
      />

      {/* ===== Bottom Sheet: Bank Report ONLY ===== */}
      <BottomSheetReportBankModal
        ref={reportBankSheetRef}
        isReported={(accNormalized) => !!reportedBankMap[accNormalized]}
          onReport={async ({ bankName, account, note }) => {
            const accNormalized = normalizeBankAccount(account);
            const alreadyReported = !!reportedBankMap[accNormalized];
            if (alreadyReported) {
              // UNREPORT
              try {
                const ok = await unreportBankOnServer(bankName, account);
                if (ok) {
                  setReportedBankMap((prev) => {
                    const next = { ...prev };
                    delete next[accNormalized];
                    persistReportedBank(next);
                    return next;
                  });
                  Alert.alert("ปลดรายงานสำเร็จ", "บัญชีนี้ถูกปลดรายงานแล้ว");
                } else {
                  Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถปลดรายงานบัญชีได้");
                }
              } catch (e: any) {
                Alert.alert("เกิดข้อผิดพลาด", e?.message || "Unreport error");
              }
            } else {
              // REPORT
              try {
                const ok = await reportBankOnServer(bankName, account, note);
                if (ok) {
                  setReportedBankMap((prev) => {
                    const next = { ...prev, [accNormalized]: true };
                    persistReportedBank(next);
                    return next;
                  });
                  Alert.alert("รายงานสำเร็จ", "ขอบคุณที่แจ้งบัญชี");
                } else {
                  Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถรายงานบัญชีได้");
                }
              } catch (e: any) {
                Alert.alert("เกิดข้อผิดพลาด", e?.message || "Report error");
              }
            }
          }}
      />
    </ScrollView>
  );
};

/* ====================== */
/* ===== COMPONENTS ===== */
/* ====================== */

const InfoRow = ({
  label,
  value,
  copyable,
  onCopy,
}: {
  label: string;
  value?: string | number;
  copyable?: boolean;
  onCopy?: (v?: string) => void;
}) => {
  const display = value != null && String(value).trim() !== "" ? String(value) : "-";

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoValue}>{display}</Text>
        {copyable && display !== "-" ? (
          <Pressable onPress={() => onCopy?.(display)} hitSlop={10}>
            <Text style={styles.copyHint}>แตะเพื่อคัดลอก</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const SectionTitle = ({ title }: { title: string }) => <Text style={styles.sectionTitle}>{title}</Text>;

/* ====================== */
/* ===== STYLES ===== */
/* ====================== */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    padding: 14,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0b0f",
    paddingHorizontal: 18,
  },
  emptyText: { color: "#6b7280", fontSize: 14 },
  errorText: { color: "#ff3b30", fontSize: 14, textAlign: "center" },

  btnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#2563eb",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2b2b2b",
  },
  btnGhostText: { color: "#e5e7eb", fontWeight: "800" },

  bodyTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#fff",
    lineHeight: 24,
    marginBottom: 12,
  },

  navActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 6,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },

  infoRow: { flexDirection: "row", marginBottom: 10 },
  infoLabel: { width: 120, color: "#9ca3af", fontSize: 13 },
  infoValue: { color: "#fff", fontSize: 14, lineHeight: 20 },
  copyHint: { fontSize: 11, color: "#60a5fa", marginTop: 2 },
  copyHintSmall: { fontSize: 11, color: "#60a5fa", marginTop: 2 },

  sectionTitle: {
    color: "#fff",
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 8,
    fontSize: 15,
  },

  rowItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
    gap: 10,
  },
  rowIndex: { width: 22, color: "#9ca3af", marginTop: 2 },
  rowText: { color: "#fff", fontSize: 14, lineHeight: 18 },

  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#374151",
    borderWidth: 1,
    borderColor: "#4b5563",
  },
  actionPillDanger: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  actionPillOk: { backgroundColor: "#34c759", borderColor: "#34c759" },
  actionPillText: { color: "#fff", fontSize: 12, fontWeight: "900" },

  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  imageWrap: { borderRadius: 8, overflow: "hidden", backgroundColor: "#111" },
  image: { width: 110, height: 110, borderRadius: 8, backgroundColor: "#111" },
  hint: { marginTop: 8, color: "#6b7280", fontSize: 12 },

  copyText: { color: "#60a5fa", fontSize: 13, marginTop: 2 },

  commentsCol: {
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    padding: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#222",
    marginTop: 2,
  },
});