import React, { useMemo, useLayoutEffect, useCallback, useEffect } from "react";
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
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import Clipboard from "@react-native-clipboard/clipboard";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import ImageViewing from "react-native-image-viewing";
import { gql } from "@apollo/client";

import type { RootStackParamList } from "../navigation/types";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import { CommentsSection } from "../components/comments/CommentsSection";
import { useAuth } from "../auth/AuthProvider";

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

const CLONE_POST = gql`
  mutation ($id: ID!) {
    clonePost(id: $id)
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

  author?: { id: string };
  is_bookmarked?: boolean;
};

type Props = NativeStackScreenProps<RootStackParamList, "PostView">;

/* =======================
 * Screen
 * ======================= */

export const PostViewScreen: React.FC<Props> = ({ route, navigation }) => {
  const { id, currentUserId } = route.params;
  const { isLoggedIn } = useAuth();

  const [post, setPost] = React.useState<PostRecord | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // bookmark busy
  const [bookmarkBusy, setBookmarkBusy] = React.useState(false);

  // images preview
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);

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

  useEffect(() => {
    fetchPost();
  }, [fetchPost]);

  /* =======================
   * Helpers
   * ======================= */

  const isOwner = !!currentUserId && currentUserId === post?.author?.id;

  const isFbPublished =
    String(post?.fb_status || "").toUpperCase() === "PUBLISHED" &&
    !!post?.fb_permalink_url;

  const isBookmarked = !!post?.is_bookmarked;

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

  /* =======================
   * ✅ Bookmark toggle
   * ======================= */
  const onToggleBookmark = useCallback(async () => {
    if (!post?.id) return;

    if (!isLoggedIn) {
      Alert.alert("ต้องเข้าสู่ระบบ", "กรุณา login ก่อนใช้งาน bookmark");
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
    } catch (e: any) {
      // rollback
      setPost((p) => (p ? { ...p, is_bookmarked: prevVal } : p));
      Alert.alert("Bookmark error", e?.message || "Please login first or try again.");
    } finally {
      setBookmarkBusy(false);
    }
  }, [post?.id, post?.is_bookmarked, isLoggedIn, bookmarkBusy]);

  /* =======================
   * Delete / Clone (optional)
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

  const handleClone = useCallback(async () => {
    try {
      const { data } = await client.mutate({
        mutation: CLONE_POST,
        variables: { id },
      });

      const newId = data?.clonePost;
      if (newId) {
        Alert.alert("สำเร็จ", "Clone สำเร็จ");
        navigation.replace("PostView", {
          id: String(newId),
          currentUserId,
        });
      } else {
        Alert.alert("ไม่สำเร็จ", "Clone ไม่สำเร็จ");
      }
    } catch (e: any) {
      Alert.alert("เกิดข้อผิดพลาด", e?.message || "Clone error");
    }
  }, [id, navigation, currentUserId]);

  /* =======================
   * ✅ Navigation header (do NOT use post.title here)
   * ======================= */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      // ✅ ไม่เอา title ไปไว้ที่ navigation
      title: "",
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerRight: () => (
        <View style={styles.navActions}>
          {/* ✅ BOOKMARK (เงื่อนไขเดิม: !isOwner) */}
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

          {/* Facebook */}
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

          {/* Share */}
          <Pressable onPress={onShare} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </Pressable>

          {/* Owner actions */}
          {isOwner ? (
            <>
              <Pressable
                onPress={() => navigation.navigate("PostForm", { id: String(post?.id) })}
                hitSlop={10}
                style={styles.navBtn}
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
              </Pressable>

              {/* <Pressable onPress={handleClone} hitSlop={10} style={styles.navBtn}>
                <Ionicons name="copy-outline" size={22} color="#fff" />
              </Pressable> */}

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
    post?.fb_permalink_url,
    isOwner,
    isFbPublished,
    isBookmarked,
    bookmarkBusy,
    onToggleBookmark,
    onShare,
    openUrl,
    handleDelete,
    handleClone,
  ]);

  /* =======================
   * Render list items
   * ======================= */

  const renderTelItem = useCallback(
    ({ item, index }: { item: { id: string; tel: string }; index: number }) => (
      <RowItem index={index} value={item.tel} onCopy={() => copyText(item.tel)} />
    ),
    [copyText]
  );

  const renderAccountItem = useCallback(
    ({
      item,
      index,
    }: {
      item: { id: string; bank_name?: string; seller_account?: string };
      index: number;
    }) => (
      <View style={styles.rowItem}>
        <Text style={styles.rowIndex}>{index + 1}.</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowText}>{item.bank_name || "-"}</Text>
          <Pressable onPress={() => copyText(item.seller_account || "")}>
            <Text style={styles.copyText}>{item.seller_account || "-"}</Text>
          </Pressable>
        </View>
      </View>
    ),
    [copyText]
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
      {/* ✅ TITLE อยู่ใน body ตามที่ขอ */}
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

const RowItem = ({
  index,
  value,
  onCopy,
}: {
  index: number;
  value?: string;
  onCopy?: () => void;
}) => {
  const display = value && String(value).trim() ? String(value) : "-";

  return (
    <View style={styles.rowItem}>
      <Text style={styles.rowIndex}>{index + 1}.</Text>
      <Pressable onPress={onCopy} hitSlop={10} style={{ flex: 1 }}>
        <Text style={styles.rowText}>{display}</Text>
        {display !== "-" ? <Text style={styles.copyHintSmall}>แตะเพื่อคัดลอก</Text> : null}
      </Pressable>
    </View>
  );
};

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

  // ✅ title in body
  bodyTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#fff",
    lineHeight: 24,
    marginBottom: 12,
  },

  // ✅ actions in navigation
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
  },
  rowIndex: { width: 22, color: "#9ca3af", marginTop: 2 },
  rowText: { color: "#fff", fontSize: 14, lineHeight: 18 },

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
