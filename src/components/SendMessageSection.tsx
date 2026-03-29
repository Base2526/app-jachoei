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
import Geolocation from "@react-native-community/geolocation";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
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

export type SendLocationPayload = {
  latitude: number;
  longitude: number;
  placeName?: string | null;
  googleMapsUrl: string;
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
    location?: SendLocationPayload | null;
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

type PlaceSearchResult = {
  placeName: string;
  latitude: number;
  longitude: number;
};

type MapCenterMsg = {
  type: "center";
  latitude: number;
  longitude: number;
  zoom?: number;
};

type MapReadyMsg = { type: "ready" };

const DEFAULT_MAP_CENTER = { latitude: 13.7563, longitude: 100.5018, zoom: 14 }; // Bangkok

function buildLeafletHtml() {
  // Uses Leaflet + OpenStreetMap tiles.
  // Gestures: pan + pinch-zoom are handled inside the map.
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossorigin=""
      />
      <style>
        html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: #0b0b0f; }
        .leaflet-control-attribution { font-size: 11px; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossorigin=""
      ></script>
      <script>
        (function() {
          var map = L.map('map', {
            zoomControl: false,
            attributionControl: true,
            zoomSnap: 0.25,
            inertia: true,
            worldCopyJump: true
          }).setView([${DEFAULT_MAP_CENTER.latitude}, ${DEFAULT_MAP_CENTER.longitude}], ${DEFAULT_MAP_CENTER.zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            crossOrigin: true,
            attribution: '&copy; OpenStreetMap'
          }).addTo(map);

          function postCenter() {
            try {
              var c = map.getCenter();
              var z = map.getZoom();
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'center',
                latitude: c.lat,
                longitude: c.lng,
                zoom: z
              }));
            } catch (e) {}
          }

          window.__setCenter = function(lat, lng, zoom) {
            try {
              var z = (typeof zoom === 'number' && isFinite(zoom)) ? zoom : map.getZoom();
              map.setView([lat, lng], z, { animate: true });
              postCenter();
            } catch (e) {}
          };

          map.on('moveend', postCenter);
          map.on('click', function(e) {
            try {
              map.panTo(e.latlng, { animate: true });
            } catch (err) {}
            postCenter();
          });

          setTimeout(function() {
            try {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
              postCenter();
            } catch (e) {}
          }, 50);
        })();
      </script>
    </body>
  </html>`;
}

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
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);

  // ===== location share (Phase 1) =====
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);

  // ===== location picker (Google Maps-like) =====
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedLat, setSelectedLat] = useState<number>(DEFAULT_MAP_CENTER.latitude);
  const [selectedLng, setSelectedLng] = useState<number>(DEFAULT_MAP_CENTER.longitude);
  const [selectedZoom, setSelectedZoom] = useState<number>(DEFAULT_MAP_CENTER.zoom);
  const [selectedPlaceName, setSelectedPlaceName] = useState<string>("");
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseErr, setReverseErr] = useState<string>("");
  const [shouldFocusSearch, setShouldFocusSearch] = useState(false);

  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<PlaceSearchResult[]>([]);
  const [locationSearchErr, setLocationSearchErr] = useState<string>("");

  const inFlightPayloadsRef = useRef<Set<string>>(new Set());
  const openingCameraRef = useRef(false);

  const inputRef = useRef<TextInput>(null);
  const searchInputRef = useRef<TextInput>(null);
  const mapRef = useRef<WebView | null>(null);
  const pendingCenterRef = useRef<{ latitude: number; longitude: number; zoom?: number } | null>(null);
  const reverseReqIdRef = useRef(0);

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
  const attachDisabled = disabled || isSending || recording;
  const showSendPrimary = !onPressMic || canSend;
  const showMicPrimary = !!onPressMic && !canSend;

  const buildGoogleMapsUrl = useCallback((latitude: number, longitude: number) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://maps.google.com/?q=${lat},${lng}`;
  }, []);

  const mapHtml = useMemo(() => buildLeafletHtml(), []);

  const setMapCenter = useCallback((latitude: number, longitude: number, zoom?: number) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const z = typeof zoom === "number" && Number.isFinite(zoom) ? zoom : undefined;
    if (!mapReady) {
      pendingCenterRef.current = { latitude: lat, longitude: lng, zoom: z };
      setSelectedLat(lat);
      setSelectedLng(lng);
      if (typeof z === "number") setSelectedZoom(z);
      return;
    }

    const js = `window.__setCenter && window.__setCenter(${lat}, ${lng}, ${typeof z === "number" ? z : "undefined"}); true;`;
    mapRef.current?.injectJavaScript(js);
  }, [mapReady]);

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
        location: null,
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

  const requestLocationPermissionAndroid = useCallback(async () => {
    if (Platform.OS !== "android") return true;

    try {
      const fine = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location permission",
          message: "Allow location access to share your current location.",
          buttonPositive: "OK",
          buttonNegative: "Cancel",
        }
      );

      if (fine === PermissionsAndroid.RESULTS.GRANTED) return true;

      const coarse = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
      );
      return coarse === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(async () => {
    if (Platform.OS === "ios") {
      try {
        (Geolocation as any).requestAuthorization?.("whenInUse");
      } catch {
        // ignore
      }
    }

    const ok = await requestLocationPermissionAndroid();
    if (!ok) {
      Alert.alert("Location permission", "Location access was denied.");
      return null;
    }

    return await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      Geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return resolve(null);
          resolve({ latitude: lat, longitude: lng });
        },
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        }
      );
    });
  }, [requestLocationPermissionAndroid]);

  const sendLocation = useCallback(
    async (payload: SendLocationPayload) => {
      if (!sel || !chat || !me?.id || !toUserIds.length) return;
      if (isSending || recording) return;

      const lat = Number(payload.latitude);
      const lng = Number(payload.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        Alert.alert(t("common.unknown_error"), "Invalid coordinates");
        return;
      }

      const url = String(payload.googleMapsUrl || "").trim() || buildGoogleMapsUrl(lat, lng);
      if (!url) {
        Alert.alert(t("common.unknown_error"), "Cannot build Google Maps link");
        return;
      }

      const fp = [sel, "LOCATION", String(lat), String(lng), payload.placeName ?? "", url].join("::");
      if (inFlightPayloadsRef.current.has(fp)) return;

      inFlightPayloadsRef.current.add(fp);
      setIsSendingText(true);

      try {
        await onSend({
          chat_id: sel,
          text: "",
          to_user_ids: toUserIds,
          images: [],
          location: {
            latitude: lat,
            longitude: lng,
            placeName: payload.placeName ?? null,
            googleMapsUrl: url,
          },
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
        inFlightPayloadsRef.current.delete(fp);
        setIsSendingText(false);
        setIsSendingMedia(false);
      }
    },
    [
      sel,
      chat,
      me?.id,
      toUserIds,
      isSending,
      recording,
      onSend,
      replyTarget?.id,
      setReplyTarget,
      setText,
      t,
      buildGoogleMapsUrl,
    ]
  );

  const openLocationMenu = useCallback(() => {
    if (attachDisabled) return;
    Keyboard.dismiss();
    setShowEmoji(false);
    setAttachMenuOpen(false);
    setLocationMenuOpen(true);
  }, [attachDisabled]);

  const closeLocationModals = useCallback(() => {
    setLocationMenuOpen(false);
    setLocationPickerOpen(false);
    setMapReady(false);
    pendingCenterRef.current = null;
    setLocationBusy(false);
    setLocationQuery("");
    setLocationResults([]);
    setLocationSearchErr("");
    setShouldFocusSearch(false);
    setReverseBusy(false);
    setReverseErr("");
  }, []);

  const onUseCurrentLocation = useCallback(async () => {
    if (locationBusy) return;
    setLocationBusy(true);
    try {
      const pos = await getCurrentPosition();
      if (!pos) {
        Alert.alert(t("common.unknown_error"), "Current location unavailable");
        return;
      }

      await sendLocation({
        latitude: pos.latitude,
        longitude: pos.longitude,
        placeName: null,
        googleMapsUrl: buildGoogleMapsUrl(pos.latitude, pos.longitude),
      });

      closeLocationModals();
    } finally {
      setLocationBusy(false);
    }
  }, [buildGoogleMapsUrl, closeLocationModals, getCurrentPosition, locationBusy, sendLocation, t]);

  const openSearchLocation = useCallback(() => {
    setLocationMenuOpen(false);
    setLocationPickerOpen(true);
    setMapReady(false);
    pendingCenterRef.current = {
      latitude: Number(selectedLat),
      longitude: Number(selectedLng),
      zoom: Number(selectedZoom),
    };
    setShouldFocusSearch(true);
    setLocationQuery("");
    setLocationResults([]);
    setLocationSearchErr("");
    setSelectedPlaceName("");
    setReverseBusy(false);
    setReverseErr("");
  }, [selectedLat, selectedLng, selectedZoom]);

  const onMapMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event?.nativeEvent?.data;
      if (typeof raw !== "string" || !raw) return;

      let msg: MapReadyMsg | MapCenterMsg | null = null;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ready") {
        setMapReady(true);
        const pending = pendingCenterRef.current;
        if (pending && Number.isFinite(pending.latitude) && Number.isFinite(pending.longitude)) {
          pendingCenterRef.current = null;
          setTimeout(() => {
            setMapCenter(pending.latitude, pending.longitude, pending.zoom);
          }, 0);
        }

        return;
      }

      if (msg.type === "center") {
        if (Number.isFinite(msg.latitude)) setSelectedLat(Number(msg.latitude));
        if (Number.isFinite(msg.longitude)) setSelectedLng(Number(msg.longitude));
        if (Number.isFinite(msg.zoom)) setSelectedZoom(Number(msg.zoom));
        setSelectedPlaceName("");
        setReverseErr("");
        return;
      }
    },
    [setMapCenter]
  );

  useEffect(() => {
    if (!locationPickerOpen || !shouldFocusSearch) return;
    const tick = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 200);
    return () => clearTimeout(tick);
  }, [locationPickerOpen, shouldFocusSearch]);

  useEffect(() => {
    if (!locationPickerOpen) return;
    const q = locationQuery.trim();
    if (q.length < 3) {
      setLocationResults([]);
      setLocationSearchErr("");
      return;
    }

    let cancelled = false;
    const tick = setTimeout(async () => {
      try {
        setLocationSearchErr("");

        // Lightweight geocoding search (no API key).
        const url =
          "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=" +
          encodeURIComponent(q);

        const resp = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "JachoeiMobile/1.0",
          },
        });

        if (!resp.ok) throw new Error(String(resp.status));
        const json = (await resp.json()) as any[];

        const mapped: PlaceSearchResult[] = Array.isArray(json)
          ? json
              .map((r) => {
                const lat = Number(r?.lat);
                const lng = Number(r?.lon);
                const name = String(r?.display_name || "").trim();
                if (!name) return null;
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                return { placeName: name, latitude: lat, longitude: lng } as PlaceSearchResult;
              })
              .filter((v): v is PlaceSearchResult => !!v)
          : [];

        if (!cancelled) setLocationResults(mapped);
      } catch {
        if (!cancelled) setLocationSearchErr("Search failed");
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(tick);
    };
  }, [locationQuery, locationPickerOpen]);

  useEffect(() => {
    if (!locationPickerOpen) return;

    const lat = Number(selectedLat);
    const lng = Number(selectedLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const reqId = (reverseReqIdRef.current += 1);
    setReverseBusy(true);
    setReverseErr("");

    let cancelled = false;
    const tick = setTimeout(async () => {
      try {
        const url =
          "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=" +
          encodeURIComponent(String(lat)) +
          "&lon=" +
          encodeURIComponent(String(lng));

        const resp = await fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "JachoeiMobile/1.0",
          },
        });

        if (!resp.ok) throw new Error(String(resp.status));
        const json = (await resp.json()) as any;
        const name = String(json?.display_name || "").trim();

        if (!cancelled && reqId === reverseReqIdRef.current) {
          setSelectedPlaceName(name);
          setReverseBusy(false);
        }
      } catch {
        if (!cancelled && reqId === reverseReqIdRef.current) {
          setReverseErr("Reverse geocoding failed");
          setReverseBusy(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(tick);
    };
  }, [locationPickerOpen, selectedLat, selectedLng]);

  const onConfirmPickedLocation = useCallback(async () => {
    if (locationBusy) return;
    const lat = Number(selectedLat);
    const lng = Number(selectedLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert(t("common.unknown_error"), "Location unavailable");
      return;
    }

    setLocationBusy(true);
    try {
      await sendLocation({
        latitude: lat,
        longitude: lng,
        placeName: selectedPlaceName?.trim() ? selectedPlaceName.trim() : null,
        googleMapsUrl: buildGoogleMapsUrl(lat, lng),
      });
      closeLocationModals();
    } finally {
      setLocationBusy(false);
    }
  }, [buildGoogleMapsUrl, closeLocationModals, locationBusy, selectedLat, selectedLng, selectedPlaceName, sendLocation, t]);

  const onPressSend = useCallback(() => {
    handleSend();
  }, [handleSend]);

  const onToggleEmoji = useCallback(() => {
    if (disabled || isSending) return;
    Keyboard.dismiss();
    setShowEmoji((s) => !s);
  }, [disabled, isSending]);

  const closeAttachMenu = useCallback(() => {
    setAttachMenuOpen(false);
  }, []);

  const openAttachMenu = useCallback(() => {
    if (attachDisabled) return;
    if (images.length >= MAX_IMAGES) {
      Alert.alert(t("chat.image_limit_title"), t("chat.image_limit_text", { count: MAX_IMAGES }));
      return;
    }
    Keyboard.dismiss();
    setShowEmoji(false);
    setAttachMenuOpen(true);
  }, [attachDisabled, images.length, t]);

  const runAttachAction = useCallback(
    (action: () => Promise<void> | void) => {
      setAttachMenuOpen(false);
      setTimeout(() => {
        action();
      }, 10);
    },
    []
  );

  return (
    <View style={styles.wrap}>
      {/* ===== Reply Preview ===== */}
      {!!replyTarget && (
        <View style={styles.replyBox}>
          <View style={styles.flexMinWidth0}>
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
                      <Image source={{ uri }} style={[styles.replyThumb, isLast && styles.replyThumbFaded]} />
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
        <View style={styles.imagesPreviewWrap}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={images}
            keyExtractor={(it) => it.uri}
            contentContainerStyle={styles.imagesListContainer}
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
          onPress={openAttachMenu}
          disabled={attachDisabled}
          style={({ pressed }) => [
            styles.iconBtn,
            attachDisabled && { opacity: 0.35 },
            pressed && !attachDisabled && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="add" size={22} color="#e5e7eb" />
        </Pressable>

        <Pressable
          onPress={onToggleEmoji}
          disabled={disabled || isSending || recording}
          style={({ pressed }) => [
            styles.iconBtn,
            (disabled || isSending || recording) && { opacity: 0.35 },
            pressed && !(disabled || isSending || recording) && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="happy-outline" size={20} color="#e5e7eb" />
        </Pressable>

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

        {showMicPrimary ? (
          <Pressable
            onPress={onPressMic}
            disabled={disabled || isSending || recording}
            style={({ pressed }) => [
              styles.iconBtn,
              (disabled || isSending || recording) && { opacity: 0.35 },
              pressed && !(disabled || isSending || recording) && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="mic-outline" size={20} color="#e5e7eb" />
          </Pressable>
        ) : null}

        {showSendPrimary ? (
          <Pressable
            onPress={onPressSend}
            disabled={!canSend || isSending || recording}
            style={({ pressed }) => [
              styles.sendBtn,
              (!canSend || isSending || recording) && { opacity: 0.45 },
              pressed && canSend && !isSending && !recording && { opacity: 0.88 },
            ]}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#0b0b0f" />
            ) : (
              <Ionicons name="send" size={18} color="#0b0b0f" />
            )}
          </Pressable>
        ) : null}

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

      {/* ===== Attach Menu (compact +) ===== */}
      <Modal
        visible={attachMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAttachMenu}
      >
        <Pressable style={styles.attachOverlay} onPress={closeAttachMenu}>
          <Pressable style={styles.attachSheet} onPress={() => {}}>
            <Text style={styles.attachTitle}>Attach</Text>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
              onPress={() => runAttachAction(takePhoto)}
              disabled={attachDisabled}
            >
              <Ionicons name="camera-outline" size={18} color="#e5e7eb" />
              <Text style={styles.attachItemText}>Camera</Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
              onPress={() => runAttachAction(pickImages)}
              disabled={attachDisabled}
            >
              <Ionicons name="image-outline" size={18} color="#e5e7eb" />
              <Text style={styles.attachItemText}>Photos</Text>
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
              onPress={openLocationMenu}
              disabled={attachDisabled}
            >
              <Ionicons name="location-outline" size={18} color="#e5e7eb" />
              <Text style={styles.attachItemText}>Location</Text>
            </Pressable>

            {!!onPressMic && showSendPrimary && (
              <Pressable
                android_ripple={{ color: "rgba(255,255,255,0.10)" }}
                style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
                onPress={() => runAttachAction(onPressMic)}
                disabled={attachDisabled}
              >
                <Ionicons name="mic-outline" size={18} color="#e5e7eb" />
                <Text style={styles.attachItemText}>Voice message</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Location Menu ===== */}
      <Modal
        visible={locationMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeLocationModals}
      >
        <Pressable style={styles.attachOverlay} onPress={closeLocationModals}>
          <Pressable style={styles.attachSheet} onPress={() => {}}>
            <Text style={styles.attachTitle}>Share location</Text>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
              onPress={onUseCurrentLocation}
              disabled={attachDisabled || locationBusy}
            >
              <Ionicons name="navigate-outline" size={18} color="#e5e7eb" />
              <Text style={styles.attachItemText}>Use current location</Text>
              {locationBusy ? <ActivityIndicator /> : null}
            </Pressable>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.attachItem, pressed && styles.attachItemPressed]}
              onPress={openSearchLocation}
              disabled={attachDisabled || locationBusy}
            >
              <Ionicons name="search-outline" size={18} color="#e5e7eb" />
              <Text style={styles.attachItemText}>Search location</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ===== Location Picker (Map) ===== */}
      <Modal visible={locationPickerOpen} animationType="slide" onRequestClose={closeLocationModals}>
        <View style={styles.locPickerRoot}>
          <View style={styles.locPickerTopBar}>
            <Pressable onPress={closeLocationModals} hitSlop={10} style={styles.locPickerCloseBtn}>
              <Ionicons name="close" size={22} color="#e5e7eb" />
            </Pressable>

            <View style={styles.locPickerSearchBox}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput
                ref={searchInputRef}
                value={locationQuery}
                onChangeText={setLocationQuery}
                onFocus={() => setShouldFocusSearch(true)}
                onBlur={() => setShouldFocusSearch(false)}
                placeholder="Search a place"
                placeholderTextColor="#6b7280"
                style={styles.locPickerSearchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
            </View>
          </View>

          <View style={styles.locPickerMapWrap}>
            <WebView
              ref={(r) => {
                mapRef.current = r;
              }}
              originWhitelist={["*"]}
              source={{ html: mapHtml }}
              onMessage={onMapMessage}
            />

            <View pointerEvents="none" style={styles.locPickerCenterPin}>
              <Ionicons name="location-sharp" size={34} color="#60a5fa" />
            </View>
          </View>

          {(locationQuery.trim().length >= 3 || locationSearchErr) && shouldFocusSearch ? (
            <View style={styles.locPickerResultsOverlay}>
              {locationSearchErr ? <Text style={styles.locErrText}>{locationSearchErr}</Text> : null}

              {locationResults.map((r) => (
                <Pressable
                  key={`${r.latitude},${r.longitude},${r.placeName}`}
                  android_ripple={{ color: "rgba(255,255,255,0.10)" }}
                  style={({ pressed }) => [styles.locResultRow, pressed && { opacity: 0.9 }]}
                  onPress={() => {
                    setSelectedPlaceName(r.placeName);
                    setLocationQuery(r.placeName);
                    setShouldFocusSearch(false);
                    setLocationResults([]);
                    Keyboard.dismiss();
                    setMapCenter(r.latitude, r.longitude, 16);
                  }}
                >
                  <Ionicons name="location" size={16} color="#93c5fd" />
                  <View style={styles.flexMinWidth0}>
                    <Text style={styles.locResultTitle} numberOfLines={2}>
                      {r.placeName}
                    </Text>
                    <Text style={styles.locResultSub} numberOfLines={1}>
                      {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#6b7280" />
                </Pressable>
              ))}

              {!locationResults.length && locationQuery.trim().length >= 3 && !locationSearchErr ? (
                <Text style={styles.locEmptyText}>No results</Text>
              ) : null}

              {locationQuery.trim().length < 3 ? (
                <Text style={styles.locHintText}>Type at least 3 characters</Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.locPickerBottomSheet}>
            <Text style={styles.locPickerBottomTitle}>Selected location</Text>

            {reverseErr ? <Text style={styles.locErrText}>{reverseErr}</Text> : null}

            {reverseBusy ? (
              <Text style={styles.locPickerBottomSub}>Looking up place name…</Text>
            ) : selectedPlaceName ? (
              <Text style={styles.locPickerBottomSub} numberOfLines={2}>
                {selectedPlaceName}
              </Text>
            ) : null}

            <Text style={styles.locPickerCoords}>
              {Number(selectedLat).toFixed(5)}, {Number(selectedLng).toFixed(5)}
            </Text>

            <Pressable
              android_ripple={{ color: "rgba(255,255,255,0.10)" }}
              style={({ pressed }) => [styles.locPickerConfirmBtn, pressed && { opacity: 0.9 }]}
              onPress={onConfirmPickedLocation}
              disabled={locationBusy}
            >
              {locationBusy ? <ActivityIndicator /> : <Ionicons name="send" size={16} color="#e5e7eb" />}
              <Text style={styles.locPickerConfirmText}>Share this location</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flexMinWidth0: { flex: 1, minWidth: 0 },
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
  replyThumbFaded: { opacity: 0.75 },
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
  imagesPreviewWrap: { marginBottom: 10 },
  imagesListContainer: { gap: 10 },
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
    gap: 6,
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 8,
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
    width: 34,
    height: 34,
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
    paddingTop: 6,
    paddingBottom: 4,
    color: "#e5e7eb",
    fontSize: 15,
    lineHeight: 20,
  },

  // ✅ send button โทนฟ้าอ่อนแบบ iOS ในรูป
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#93c5fd",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  // ===== attach menu =====
  attachOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  attachSheet: {
    backgroundColor: "#111116",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  attachTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "left",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  attachItem: {
    width: "100%",
    minHeight: 52,
    backgroundColor: "#0f1117",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  attachItemPressed: {
    opacity: 0.85,
  },
  attachItemText: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "left",
    flex: 1,
  },

  // ===== location search =====
  locHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  locCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
    alignItems: "center",
    justifyContent: "center",
  },
  locSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  locSearchInput: { flex: 1, minWidth: 0, color: "#e5e7eb", fontSize: 14 },
  locErrText: { color: "#f87171", fontWeight: "800", marginBottom: 8 },
  locResultsWrap: { gap: 8, maxHeight: 320 },
  locResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  locResultTitle: { color: "#f3f4f6", fontWeight: "900", fontSize: 13 },
  locResultSub: { color: "#9ca3af", marginTop: 4, fontSize: 12, fontWeight: "700" },
  locHintText: { color: "#9ca3af", fontSize: 12, fontWeight: "700", paddingVertical: 6 },
  locEmptyText: { color: "#9ca3af", fontSize: 12, fontWeight: "700", paddingVertical: 6 },

  // ===== location picker (map) =====
  locPickerRoot: {
    flex: 1,
    backgroundColor: "#0b0b0f",
  },
  locPickerTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f1f26",
    backgroundColor: "#0b0b0f",
  },
  locPickerCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
    alignItems: "center",
    justifyContent: "center",
  },
  locPickerSearchBox: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  locPickerSearchInput: {
    flex: 1,
    minWidth: 0,
    color: "#e5e7eb",
    fontSize: 14,
    paddingVertical: 10,
  },
  locPickerMapWrap: {
    flex: 1,
    position: "relative",
    backgroundColor: "#0b0b0f",
  },
  locPickerCenterPin: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    marginTop: -34,
    alignItems: "center",
    justifyContent: "center",
  },
  locPickerResultsOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 64,
    maxHeight: 320,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(17,17,22,0.98)",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  locPickerBottomSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: "rgba(11,11,15,0.96)",
    borderTopWidth: 1,
    borderTopColor: "#1f1f26",
  },
  locPickerBottomTitle: { color: "#fff", fontSize: 14, fontWeight: "900", marginBottom: 6 },
  locPickerBottomSub: { color: "#e5e7eb", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  locPickerCoords: { color: "#9ca3af", fontSize: 12, fontWeight: "800", marginBottom: 12 },
  locPickerConfirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#1f1f26",
  },
  locPickerConfirmText: { color: "#f3f4f6", fontSize: 14, fontWeight: "900" },

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
