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
  ActivityIndicator,
  PermissionsAndroid,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import {
  launchCamera,
  launchImageLibrary,
  Asset,
  CameraOptions,
  ImageLibraryOptions,
} from "react-native-image-picker";
import { createClientMessageId } from "../utils/chat";
import { useI18n } from "../i18n";

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
    client_message_id?: string | null;
  }) => Promise<void>;

  onPressMic?: () => void;

  isRecording?: boolean;
  recordingSec?: number;
  onCancelRecording?: () => void;

  me: Me;

  replyTarget: any | null; // message object
  setReplyTarget: (t: any | null) => void;
};

const EMOJIS = ["😀", "😁", "😂", "🤣", "😊", "😍", "😎", "🤔", "😢", "🙏", "👍", "🔥", "💯", "🎉", "✨", "❤️", "😡"];

function formatMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function SendMessageSection({
  chats,
  sel,
  text,
  setText,
  onSend,
  onPressMic,
  isRecording,
  recordingSec,
  onCancelRecording,
  me,
  replyTarget,
  setReplyTarget,
}: Props) {
  const { t } = useI18n();
  const [showEmoji, setShowEmoji] = useState(false);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);

  const inFlightPayloadsRef = useRef<Set<string>>(new Set());
  const openingCameraRef = useRef(false);

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

  const isSending = isSendingText || isSendingMedia;

  const disabled = !me?.id || !chat || !sel;
  const recording = !!isRecording;

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
    if (disabled || isSending) return;

    if (images.length >= MAX_IMAGES) {
      Alert.alert(t("chat.image_limit_title"), t("chat.image_limit_text", { count: MAX_IMAGES }));
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
      Alert.alert(t("chat.pick_image_failed"), `${res.errorCode}: ${res.errorMessage ?? ""}`);
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
        Alert.alert(t("chat.image_limit_title"), t("chat.image_limit_text", { count: MAX_IMAGES }));
      }
      return next;
    });
  }, [disabled, images.length, isSending, t]);

  const requestCameraPermissionAndroid = useCallback(async () => {
    if (Platform.OS !== "android") return true;

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: "Camera permission",
          message: "Allow camera access to take a photo.",
          buttonPositive: "OK",
          buttonNegative: "Cancel",
        }
      );

      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const takePhoto = useCallback(async () => {
    if (disabled || isSending) return;
    if (openingCameraRef.current) return;
    openingCameraRef.current = true;

    try {
      Keyboard.dismiss();

      if (images.length >= MAX_IMAGES) {
        Alert.alert(t("chat.image_limit_title"), t("chat.image_limit_text", { count: MAX_IMAGES }));
        return;
      }

      const ok = await requestCameraPermissionAndroid();
      if (!ok) {
        Alert.alert("Camera permission", "Camera access was denied.");
        return;
      }

      const options: CameraOptions = {
        mediaType: "photo",
        cameraType: "back",
        saveToPhotos: false,
        quality: 0.9,
      };

      const res = await launchCamera(options);

      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert(t("chat.pick_image_failed"), `${res.errorCode}: ${res.errorMessage ?? ""}`);
        return;
      }

      const assets = (res.assets ?? []) as Asset[];
      const mapped: UploadImage[] = assets
        .filter((a) => !!a.uri)
        .map((a, idx) => ({
          uri: a.uri!,
          name: a.fileName ?? `camera-${Date.now()}-${idx}.jpg`,
          type: a.type ?? "image/jpeg",
          width: a.width,
          height: a.height,
          fileSize: a.fileSize,
        }));

      if (!mapped.length) return;

      setImages((prev) => {
        const next = [...prev, ...mapped].slice(0, MAX_IMAGES);
        if (next.length >= MAX_IMAGES) {
          Alert.alert(t("chat.image_limit_title"), t("chat.image_limit_text", { count: MAX_IMAGES }));
        }
        return next;
      });
    } finally {
      openingCameraRef.current = false;
    }
  }, [disabled, images.length, isSending, requestCameraPermissionAndroid, t]);

  const removeImage = useCallback((uri: string) => {
    if (isSending) return;
    setImages((prev) => prev.filter((x) => x.uri !== uri));
  }, [isSending]);

  // ===== reply preview =====
  const replySenderLabel = useMemo(() => {
    if (!replyTarget) return "";
    const isMine = replyTarget?.sender?.id === me?.id;
    return isMine ? t("chat.you") : replyTarget?.sender?.name || t("chat.user");
  }, [replyTarget, me?.id, t]);

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
    if (!canSend || isSending) return;

    const imageFingerprint = images
      .map((img) => `${img.uri}|${img.name ?? ""}|${img.fileSize ?? ""}`)
      .join(",");

    const payloadFingerprint = [
      sel ?? "",
      trimmed,
      toUserIds.join(","),
      replyTarget?.id ?? "",
      imageFingerprint,
    ].join("::");

    if (inFlightPayloadsRef.current.has(payloadFingerprint)) return;

    const hasMedia = images.length > 0;
    inFlightPayloadsRef.current.add(payloadFingerprint);
    setIsSendingText(!hasMedia);
    setIsSendingMedia(hasMedia);

    try {
      await onSend({
        chat_id: sel!,
        text: trimmed,
        to_user_ids: toUserIds,
        images,
        reply_to_id: replyTarget?.id ?? null,
        client_message_id: createClientMessageId(),
      });

      setText("");
      setImages([]);
      setReplyTarget(null);
      setShowEmoji(false);
      Keyboard.dismiss();
    } catch (e: any) {
      Alert.alert(t("chat.send_failed"), e?.message || t("common.unknown_error"));
    } finally {
      inFlightPayloadsRef.current.delete(payloadFingerprint);
      setIsSendingText(false);
      setIsSendingMedia(false);
    }
  }, [canSend, isSending, onSend, sel, trimmed, toUserIds, images, replyTarget?.id, setText, setReplyTarget, t]);

  const onPressSend = useCallback(() => {
    handleSend();
  }, [handleSend]);

  const onToggleEmoji = useCallback(() => {
    if (disabled || isSending) return;
    Keyboard.dismiss();
    setShowEmoji((s) => !s);
  }, [disabled, isSending]);

  return (
    <View style={styles.wrap}>
      {/* ===== Reply Preview ===== */}
      {!!replyTarget && (
        <View style={styles.replyBox}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.replyTitle}>{t("chat.replying_to")} {replySenderLabel}</Text>

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
          onPress={takePhoto}
          disabled={disabled || isSending || recording || images.length >= MAX_IMAGES}
          style={({ pressed }) => [
            styles.iconBtn,
            (disabled || isSending || recording || images.length >= MAX_IMAGES) && { opacity: 0.35 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="camera-outline" size={20} color="#e5e7eb" />
        </Pressable>

        <Pressable
          onPress={pickImages}
          disabled={disabled || isSending || recording || images.length >= MAX_IMAGES}
          style={({ pressed }) => [
            styles.iconBtn,
            (disabled || isSending || recording || images.length >= MAX_IMAGES) && { opacity: 0.35 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="image-outline" size={20} color="#e5e7eb" />
        </Pressable>

        <Pressable
          onPress={onToggleEmoji}
          disabled={disabled || isSending || recording}
          style={({ pressed }) => [styles.iconBtn, (disabled || isSending || recording) && { opacity: 0.35 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="happy-outline" size={20} color="#e5e7eb" />
        </Pressable>

        {onPressMic ? (
          <Pressable
            onPress={onPressMic}
            disabled={disabled || isSending}
            style={({ pressed }) => [
              styles.iconBtn,
              (disabled || isSending) && { opacity: 0.35 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="mic-outline" size={20} color="#e5e7eb" />
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          editable={!disabled && !isSending && !recording}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#6b7280"
          style={styles.input}
          multiline
          blurOnSubmit={false}
        />

        <Pressable
          onPress={onPressSend}
          disabled={!canSend || isSending}
          style={({ pressed }) => [
            styles.sendBtn,
            (!canSend || isSending) && { opacity: 0.45 },
            pressed && canSend && !isSending && { opacity: 0.88 },
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#0b0b0f" />
          ) : (
            <Ionicons name="send" size={18} color="#0b0b0f" />
          )}
        </Pressable>

        {recording && (
          <View style={styles.recordOverlay} pointerEvents="auto">
            <Pressable
              onPress={onCancelRecording}
              disabled={!onCancelRecording}
              style={({ pressed }) => [
                styles.recordSideBtn,
                !onCancelRecording && { opacity: 0.35 },
                pressed && onCancelRecording && { opacity: 0.85 },
              ]}
              hitSlop={10}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </Pressable>

            <View style={styles.recordCenter}>
              <Text style={styles.recordTimer}>{formatMMSS(recordingSec ?? 0)}</Text>
              <Text style={styles.recordHint}>{t("chat.recording") || "Recording"}</Text>
            </View>

            <Pressable
              onPress={onPressMic}
              disabled={!onPressMic}
              style={({ pressed }) => [
                styles.recordStopBtn,
                pressed && onPressMic && { opacity: 0.9 },
              ]}
              hitSlop={10}
            >
              <Ionicons name="stop" size={20} color="#fff" />
            </Pressable>
          </View>
        )}
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

  // ===== recording overlay =====
  recordOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderRadius: 26,
    backgroundColor: "rgba(11,11,15,0.92)",
  },
  recordSideBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.22)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordStopBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  recordCenter: { flex: 1, alignItems: "center" },
  recordTimer: { color: "#fff", fontWeight: "900", fontSize: 16 },
  recordHint: { color: "#9ca3af", fontSize: 12, marginTop: 2 },

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
