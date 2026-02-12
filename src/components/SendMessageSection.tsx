// src/components/SendMessageSection.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Image,
  FlatList,
  Modal,
  Alert,
  Keyboard,
  Platform,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { launchImageLibrary, Asset, ImageLibraryOptions } from "react-native-image-picker";

const MAX_IMAGES = 4;

type Member = { id: string; name?: string | null };
type Chat = { id: string; members?: Member[] | null };
type Me = { id: string; name?: string | null } | null;

export type UploadImage = {
  uri: string;
  name?: string;
  type?: string;
  width?: number;
  height?: number;
  fileSize?: number;
};

type Props = {
  chats?: { myChats?: Chat[] | null } | null;
  sel: string | null;

  text: string;
  setText: (s: string) => void;

  // ✅ ให้คุณเอาไปผูกกับ client.mutate/sendMessage เอง
  onSend: (args: {
    chat_id: string;
    text: string;
    to_user_ids: string[];
    images?: UploadImage[];
    reply_to_id?: string | null;
  }) => Promise<void>;

  me: Me;

  replyTarget: any | null; // message object
  setReplyTarget: (t: any | null) => void;
};

const EMOJIS = ["😀", "😁", "😂", "🤣", "😊", "😍", "😎", "🤔", "😢", "🙏", "👍", "🔥", "💯", "🎉", "✨", "❤️", "😡"];

export default function SendMessageSection({
  chats,
  sel,
  text,
  setText,
  onSend,
  me,
  replyTarget,
  setReplyTarget,
}: Props) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const inputRef = useRef<TextInput>(null);

  // ===== selected chat =====
  const chat = useMemo(() => chats?.myChats?.find((c) => c.id === sel) ?? null, [chats, sel]);

  const otherMembers = useMemo(() => {
    const ms = chat?.members ?? [];
    return ms.filter((m) => m?.id && m.id !== me?.id);
  }, [chat?.members, me?.id]);

  const toUserIds = useMemo(() => otherMembers.map((m) => m.id), [otherMembers]);

  const trimmed = (text ?? "").trim();

  const canSend =
    !!me?.id &&
    !!sel &&
    !!chat &&
    toUserIds.length > 0 &&
    (trimmed.length > 0 || images.length > 0);

  const disabled = !me?.id || !chat || !sel;

  // ปิด emoji เมื่อคีย์บอร์ดเปิด / กดส่ง
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => setShowEmoji(false));
    return () => sub.remove();
  }, []);

  const appendEmoji = useCallback(
    (emoji: string) => {
      setText((text ?? "") + emoji);
      inputRef.current?.focus();
    },
    [setText, text]
  );

  // ===== pick images (max 4) =====
  const pickImages = useCallback(async () => {
    if (disabled) return;

    if (images.length >= MAX_IMAGES) {
      Alert.alert("จำกัดรูป", `แนบได้สูงสุด ${MAX_IMAGES} รูปต่อ 1 ข้อความ`);
      return;
    }

    const remaining = MAX_IMAGES - images.length;

    const options: ImageLibraryOptions = {
      mediaType: "photo",
      selectionLimit: remaining, // ✅ เลือกได้เท่าที่เหลือ
      quality: 0.9,
    };

    const res = await launchImageLibrary(options);

    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert("เลือกภาพไม่ได้", `${res.errorCode}: ${res.errorMessage ?? ""}`);
      return;
    }

    const assets = (res.assets ?? []) as Asset[];

    const mapped: UploadImage[] = assets
      .filter((a) => !!a.uri)
      .map((a, idx) => ({
        uri: a.uri!,
        name: a.fileName ?? `image-${Date.now()}-${idx}.jpg`,
        type: a.type ?? "image/jpeg",
        width: a.width,
        height: a.height,
        fileSize: a.fileSize,
      }));

    setImages((prev) => {
      const next = [...prev, ...mapped].slice(0, MAX_IMAGES);
      if (next.length >= MAX_IMAGES) {
        Alert.alert("จำกัดรูป", `แนบได้สูงสุด ${MAX_IMAGES} รูปต่อ 1 ข้อความ`);
      }
      return next;
    });
  }, [disabled, images.length]);

  const removeImage = useCallback((uri: string) => {
    setImages((prev) => prev.filter((x) => x.uri !== uri));
  }, []);

  // ===== reply preview =====
  const replySenderLabel = useMemo(() => {
    if (!replyTarget) return "";
    const isMine = replyTarget?.sender?.id === me?.id;
    return isMine ? "You" : replyTarget?.sender?.name || "User";
  }, [replyTarget, me?.id]);

  const replyText = useMemo(() => {
    if (!replyTarget) return "";
    return typeof replyTarget?.text === "string" ? replyTarget.text : "";
  }, [replyTarget]);

  const replyImages = useMemo(() => {
    const arr = Array.isArray(replyTarget?.images) ? replyTarget.images : [];
    // รองรับทั้ง {url} / {file_id} / {uri}
    return arr
      .map((img: any) => img?.uri || img?.url || (img?.file_id ? `/api/files/${img.file_id}` : ""))
      .filter(Boolean) as string[];
  }, [replyTarget]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    try {
      await onSend({
        chat_id: sel!,
        text: trimmed,
        to_user_ids: toUserIds,
        images,
        reply_to_id: replyTarget?.id ?? null,
      });

      setText("");
      setImages([]);
      setReplyTarget(null);
      setShowEmoji(false);
      Keyboard.dismiss();
    } catch (e: any) {
      Alert.alert("ส่งไม่สำเร็จ", e?.message || "unknown error");
    }
  }, [canSend, onSend, sel, trimmed, toUserIds, images, replyTarget?.id, setText, setReplyTarget]);

  const onPressSend = useCallback(() => {
    handleSend();
  }, [handleSend]);

  const onToggleEmoji = useCallback(() => {
    if (disabled) return;
    Keyboard.dismiss();
    setShowEmoji((s) => !s);
  }, [disabled]);

  return (
    <View style={styles.wrap}>
      {/* ===== Reply Preview ===== */}
      {!!replyTarget && (
        <View style={styles.replyBox}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.replyTitle}>Replying to {replySenderLabel}</Text>

            {!!replyText && (
              <Text style={styles.replyText} numberOfLines={2}>
                {replyText}
              </Text>
            )}

            {!!replyImages.length && (
              <View style={styles.replyThumbRow}>
                {replyImages.slice(0, 3).map((uri, i) => {
                  const extra = replyImages.length - 3;
                  const isLast = i === 2 && extra > 0;

                  return (
                    <Pressable key={`${uri}-${i}`} onPress={() => setPreviewUri(uri)} style={styles.replyThumbWrap}>
                      <Image source={{ uri }} style={[styles.replyThumb, isLast && { opacity: 0.75 }]} />
                      {isLast && (
                        <View style={styles.replyThumbOverlay}>
                          <Text style={styles.replyThumbOverlayText}>+{extra}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <Pressable onPress={() => setReplyTarget(null)} hitSlop={10} style={styles.replyCloseBtn}>
            <Ionicons name="close" size={18} color="#9ca3af" />
          </Pressable>
        </View>
      )}

      {/* ===== Selected Image Preview (horizontal) ===== */}
      {!!images.length && (
        <View style={{ marginBottom: 10 }}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={images}
            keyExtractor={(it) => it.uri}
            contentContainerStyle={{ gap: 10 }}
            renderItem={({ item }) => (
              <View style={styles.imgChip}>
                <Pressable onPress={() => setPreviewUri(item.uri)}>
                  <Image source={{ uri: item.uri }} style={styles.imgChipImg} />
                </Pressable>

                <Pressable onPress={() => removeImage(item.uri)} style={styles.imgChipRemove} hitSlop={10}>
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                </Pressable>
              </View>
            )}
          />
          <Text style={styles.counter}>
            {images.length}/{MAX_IMAGES} images
          </Text>
        </View>
      )}

      {/* ===== Input Bar ===== */}
      <View style={styles.bar}>
        <Pressable
          onPress={pickImages}
          disabled={disabled || images.length >= MAX_IMAGES}
          style={({ pressed }) => [
            styles.iconBtn,
            (disabled || images.length >= MAX_IMAGES) && { opacity: 0.35 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="image-outline" size={20} color="#e5e7eb" />
        </Pressable>

        <Pressable
          onPress={onToggleEmoji}
          disabled={disabled}
          style={({ pressed }) => [styles.iconBtn, disabled && { opacity: 0.35 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="happy-outline" size={20} color="#e5e7eb" />
        </Pressable>

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          placeholder="Type a message..."
          placeholderTextColor="#6b7280"
          style={styles.input}
          multiline
          blurOnSubmit={false}
        />

        <Pressable
          onPress={onPressSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend && { opacity: 0.45 },
            pressed && canSend && { opacity: 0.88 },
          ]}
        >
          <Ionicons name="send" size={18} color="#0b0b0f" />
        </Pressable>
      </View>

      {/* ===== Emoji Picker ===== */}
      {showEmoji && !disabled && (
        <View style={styles.emojiBox}>
          {EMOJIS.map((em) => (
            <Pressable key={em} onPress={() => appendEmoji(em)} style={styles.emojiItem} hitSlop={8}>
              <Text style={styles.emojiText}>{em}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* ===== Image Full Preview Modal ===== */}
      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewUri(null)}>
          <View style={styles.previewInner}>
            {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImg} resizeMode="contain" /> : null}

            <Pressable style={styles.previewClose} onPress={() => setPreviewUri(null)} hitSlop={10}>
              <Ionicons name="close-circle" size={30} color="#fff" />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ✅ ดำทั้งแถบ (แทนสีขาวเดิม)
  wrap: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "#0b0b0f",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1f1f26",
    position: "relative",
  },

  // ✅ reply เป็น dark chip
  replyBox: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1f1f26",
    borderLeftWidth: 3,
    borderLeftColor: "#60a5fa",
    alignItems: "center",
  },
  replyTitle: { fontWeight: "900", color: "#93c5fd", marginBottom: 2, fontSize: 12 },
  replyText: { color: "#e5e7eb", fontSize: 12 },
  replyCloseBtn: { padding: 2 },

  replyThumbRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  replyThumbWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1f1f26",
    backgroundColor: "#0b0b0f",
  },
  replyThumb: { width: "100%", height: "100%" },
  replyThumbOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  replyThumbOverlayText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  // ✅ image chips เป็น dark
  imgChip: {
    width: 78,
    height: 78,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1f1f26",
    backgroundColor: "#111116",
  },
  imgChipImg: { width: "100%", height: "100%" },
  imgChipRemove: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { marginTop: 8, fontSize: 12, color: "#9ca3af" },

  // ✅ input bar (เหมือนในรูป: pill, shadow เบา ๆ, ดำ)
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 26,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#1f1f26",
    backgroundColor: "#0f1117",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
    }),
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#111116",
    borderWidth: 1,
    borderColor: "#1f1f26",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 38,
    paddingTop: 8,
    paddingBottom: 6,
    color: "#e5e7eb",
    fontSize: 15,
    lineHeight: 20,
  },

  // ✅ send button โทนฟ้าอ่อนแบบ iOS ในรูป
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#93c5fd",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  // ✅ emoji box เป็น dark card
  emojiBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1f1f26",
    borderRadius: 14,
    padding: 10,
    backgroundColor: "#111116",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  emojiItem: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  emojiText: { fontSize: 22 },

  // preview modal
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewInner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImg: { width: "92%", height: "82%" },
  previewClose: {
    position: "absolute",
    top: 46,
    right: 16,
  },
});
