import React, { useMemo, useLayoutEffect, useCallback } from "react";
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
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import Clipboard from "@react-native-clipboard/clipboard";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import ImageViewing from "react-native-image-viewing";

import type { RootStackParamList } from "../navigation/types";

import { ENV } from "../config/env";
import { CommentsSection } from "../components/comments/CommentsSection";

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

export const PostViewScreen: React.FC<Props> = ({ route, navigation }) => {
  // ✅ รับค่าจาก route.params
  const { post, currentUserId } = route.params as {
    post: PostRecord;
    currentUserId?: string;
  };

  // ===== IMAGES + FULLSCREEN PREVIEW =====
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);

  // แปลง image list ให้ ImageViewing ใช้
  const previewImages = React.useMemo(
    () =>
      (post.images || []).map((img) => ({
        uri: `${ENV.apiBase}${img.url}`,
      })),
    [post.images]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: post?.title ? String(post.title) : "รายละเอียดโพสต์",
      headerStyle: {
        backgroundColor: "#0b0b0f",
      },
      headerTintColor: "#fff",
    });
  }, [navigation, post?.title]);

  const isOwner = !!currentUserId && currentUserId === post.author?.id;

  const isFbPublished =
    String(post.fb_status || "").toUpperCase() === "PUBLISHED" &&
    !!post.fb_permalink_url;

  const sharePayload = useMemo(() => {
    const url = `https://jachoei.com/post/${post.id}`;
    const title = post.title || "จ่าเฉย (JACHOEI)";
    const text = post.detail
      ? `${title}\n\n${String(post.detail).slice(0, 180)}${
          String(post.detail).length > 180 ? "..." : ""
        }`
      : title;
    return { url, title, text };
  }, [post]);

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

  const renderTelItem = useCallback(
    ({ item, index }: { item: { id: string; tel: string }; index: number }) => (
      <RowItem
        index={index}
        value={item.tel}
        onCopy={() => copyText(item.tel)}
      />
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 28 }}>
      {/* ===== HEADER ACTIONS ===== */}
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>
          {post.title || "-"}
        </Text>

        <View style={styles.actions}>
          {isFbPublished && (
            <Pressable
              onPress={() => {
                Alert.alert("Open Facebook", "ต้องการเปิดโพสต์บน Facebook ไหม?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Open", onPress: () => openUrl(post.fb_permalink_url) },
                ]);
              }}
              hitSlop={10}
            >
              <Ionicons name="logo-facebook" size={22} color="#1877f2" />
            </Pressable>
          )}

          <Pressable onPress={onShare} hitSlop={10}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </Pressable>

          {isOwner && (
            <Pressable
              onPress={() => Alert.alert("TODO", "ปุ่มแก้ไข (คุณค่อยผูกหน้าต่อได้)")}
              hitSlop={10}
            >
              <Ionicons name="create-outline" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>

      {/* ===== BASIC INFO ===== */}
      <InfoRow label="รายละเอียด" value={post.detail} />
      <InfoRow label="ชื่อผู้ขาย" value={post.first_last_name} />
      <InfoRow label="เลขบัตร" value={post.id_card} copyable onCopy={copyText} />
      <InfoRow
        label="ยอดโอน"
        value={
          post.transfer_amount != null
            ? Number(post.transfer_amount).toLocaleString("th-TH", {
                minimumFractionDigits: 2,
              })
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
            scrollEnabled={false} // ✅ ไม่ชน ScrollView
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
            scrollEnabled={false} // ✅ ไม่ชน ScrollView
          />
        </>
      )}

      {/* ===== IMAGES ===== */}
      {/* {!!post.images?.length && (
        <>
          <SectionTitle title="รูปภาพแนบ" />
          <View style={styles.imageGrid}>
            {post.images.map((img) => {

              console.log("img =", img);
              return <Pressable
                        key={String(img.id)}
                        onPress={() => openUrl(`${ENV.apiBase}${img.url}`)}
                        style={styles.imageWrap}
                      >
                        <Image source={{ uri: `${ENV.apiBase}${img.url}` }} style={styles.image} />
                    </Pressable>
            })}
          </View>
          <Text style={styles.hint}>แตะรูปเพื่อเปิดดู</Text>
        </>
      )} */}

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
                <Image
                  source={{ uri: `${ENV.apiBase}${img.url}` }}
                  style={styles.image}
                />
              </Pressable>
            ))}
          </View>

          <Text style={styles.hint}>แตะรูปเพื่อดูแบบเต็มจอ</Text>

          {/* ===== FULLSCREEN IMAGE PREVIEW ===== */}
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

const SectionTitle = ({ title }: { title: string }) => (
  <Text style={styles.sectionTitle}>{title}</Text>
);

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

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    flex: 1,
    paddingRight: 10,
    lineHeight: 24,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 2,
  },

  infoRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  infoLabel: {
    width: 120,
    color: "#9ca3af",
    fontSize: 13,
  },
  infoValue: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 20,
  },
  copyHint: {
    fontSize: 11,
    color: "#60a5fa",
    marginTop: 2,
  },
  copyHintSmall: {
    fontSize: 11,
    color: "#60a5fa",
    marginTop: 2,
  },

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
  rowIndex: {
    width: 22,
    color: "#9ca3af",
    marginTop: 2,
  },
  rowText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 18,
  },
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  imageWrap: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#111",
  },

  image: {
    width: 110,
    height: 110,
    borderRadius: 8,
    backgroundColor: "#111",
  },

  hint: {
    marginTop: 8,
    color: "#6b7280",
    fontSize: 12,
  },
  copyText: {
    color: "#60a5fa",
    fontSize: 13,
    marginTop: 2,
  },
  commentsCol: {
  // ถ้าอยากให้ดูเหมือน "คอลัมน์ขวา" แยกเป็น card เล็ก ๆ
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

// sectionTitle: {
//   color: "#fff",
//   fontWeight: "800",
//   fontSize: 15,
// },

dividerLine: {
  flex: 1,
  height: StyleSheet.hairlineWidth,
  backgroundColor: "#222",
  marginTop: 2,
},

});