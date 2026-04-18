// SettingsScreen.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Picker } from "@react-native-picker/picker";
import Ionicons from "react-native-vector-icons/Ionicons";
import dayjs from "dayjs";
import { launchImageLibrary, Asset } from "react-native-image-picker";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import { useI18n } from "../i18n";
import { useContactProtection } from "../lib/contactProtection";

import { subscribeBookmarkStatusChanged } from "../events/bookmarkSync";


import { useAuth } from "../auth/AuthProvider";
import { useHiddenDiagnosticsMode } from "../lib/hiddenDiagnostics";

// ================= GraphQL =================

type Me = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  username?: string;
  language?: "en" | "th";
  notifications_enabled?: boolean;
  role?: string;
  avatar?: string;
  created_at?: string;
};

type PostRow = {
  id: string;
  title: string;
  detail?: string;
  status: "public" | "unpublic";
  created_at: string;
};

type BookmarkRow = {
  id: string;
  title: string;
  status: "public" | "unpublic";
  created_at: string;
  author?: { id: string; name?: string };
  images?: Array<{ id: string; url: string }>;
  is_bookmarked?: boolean;
};

type MeQueryData = { me: Me | null };
type MyPostsQueryData = { myPosts: PostRow[] };
type MyBookmarksQueryData = { myBookmarks: BookmarkRow[] };
type UpdateMeMutationData = { updateMe: Me | null };
type UploadAvatarMutationData = { uploadAvatar: string | null };
type DeletePostMutationData = { deletePost: boolean };
type ToggleBookmarkMutationData = {
  toggleBookmark: { ok: boolean; is_bookmarked: boolean } | null;
};

const Q_ME = gql`
  query {
    me {
      id
      name
      email
      phone
      username
      language
      notifications_enabled
      role
      avatar
      created_at
    }
  }
`;

const M_UPDATE_ME = gql`
  mutation ($data: MeInput!) {
    updateMe(data: $data) {
      id
      name
      email
      phone
      username
      language
      notifications_enabled
      avatar
    }
  }
`;

const M_UPLOAD_AVATAR = gql`
  mutation ($user_id: ID!, $file: Upload!) {
    uploadAvatar(user_id: $user_id, file: $file)
  }
`;

const Q_MY_POSTS = gql`
  query ($q: String) {
    myPosts(search: $q) {
      id
      title
      detail
      status
      created_at
    }
  }
`;

const MUT_DEL_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

const Q_MY_BOOKMARKS = gql`
  query MyBookmarks {
    myBookmarks {
      id
      title
      status
      created_at
      author {
        id
        name
      }
      images {
        id
        url
      }
      is_bookmarked
    }
  }
`;

const M_TOGGLE_BOOKMARK = gql`
  mutation ($postId: ID!) {
    toggleBookmark(postId: $postId) {
      ok
      is_bookmarked
    }
  }
`;

// ================= Helpers =================

type MenuKey = "profile" | "posts" | "bookmarks" | "security";

function maskEmail(email?: string) {
  if (!email) return "";
  const [u, d] = email.split("@");
  if (!d) return email;
  const head = u.slice(0, 2);
  return `${head}***@${d}`;
}

function toUploadFromAsset(a: Asset) {
  if (!a?.uri) return null;
  return {
    uri: a.uri,
    name: a.fileName || `avatar-${Date.now()}.jpg`,
    type: a.type || "image/jpeg",
  } as any;
}

function normalizeImageUri(uri?: string | null) {
  if (!uri) return "";

  const value = String(uri).trim();
  if (!value) return "";

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("content://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  if (value.startsWith("/")) {
    const base = ENV.apiBase.endsWith("/") ? ENV.apiBase.slice(0, -1) : ENV.apiBase;
    return `${base}${value}`;
  }

  return value;
}

function withCacheBust(uri: string, version: number) {
  if (!uri || version <= 0) return uri;
  if (!(uri.startsWith("http://") || uri.startsWith("https://"))) return uri;

  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}v=${version}`;
}

function Divider() {
  return <View style={styles.divider} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

function Pill({
  active,
  label,
  onPress,
}: {
  active?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ================= Main Screen =================

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { t, setLanguage: setAppLanguage } = useI18n();
  const hiddenDiag = useHiddenDiagnosticsMode();
  const [active, setActive] = useState<MenuKey>("profile");

  // Me/Profile
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [savingMe, setSavingMe] = useState(false);

  const [avatarLocal, setAvatarLocal] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<"en" | "th">("en");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [updatingNotifications, setUpdatingNotifications] = useState(false);
  const [username, setUsername] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);

  // Posts
  const [qPosts, setQPosts] = useState("");
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [posts, setPosts] = useState<PostRow[]>([]);

  // Bookmarks
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);

  // Security
  const [changingPass, setChangingPass] = useState(false);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  // Logout
  const [loggingOut, setLoggingOut] = useState(false);

  const { logout, user, booting, patchUser } = useAuth();

  const currentUserId = useMemo(() => {
    const id = user?.id;
    return id ? String(id) : null;
  }, [user?.id]);

  const {
    settings: contactProtectionSettings,
    updateSettings: updateContactProtectionSettings,
    loading: loadingContactProtection,
  } = useContactProtection({ enabled: !!currentUserId, userId: currentUserId });
  const [savingContactProtection, setSavingContactProtection] = useState(false);

  const displayAvatarUri = useMemo(() => {
    const localUri = normalizeImageUri(avatarLocal);
    if (localUri) return localUri;

    const remoteUri = normalizeImageUri(me?.avatar);
    return withCacheBust(remoteUri, avatarVersion);
  }, [avatarLocal, me?.avatar, avatarVersion]);

  // ===== Dirty tracking =====
  const profileSnapRef = useRef<{ name: string; phone: string; language: "en" | "th"; username: string } | null>(null);

  const profileDirty = useMemo(() => {
    const snap = profileSnapRef.current;
    if (!snap) return false;
    return (
      snap.name !== (name || "") ||
      snap.phone !== (phone || "") ||
      snap.language !== language ||
      snap.username !== (username || "")
    );
  }, [name, phone, language, username]);

  const passwordReady = useMemo(() => {
    return !!currentPass && newPass.length >= 8 && newPass === confirmPass && !changingPass;
  }, [currentPass, newPass, confirmPass, changingPass]);

  // ===== Loaders =====
  const loadMe = async () => {
    setLoadingMe(true);
    try {
      const res = await client.query<MeQueryData>({ query: Q_ME, fetchPolicy: "network-only" });
      const m = res?.data?.me ?? null;

      setMe(m || null);
      setName(m?.name || "");
      setPhone(m?.phone || "");
      const nextLanguage = ((m?.language as any) || "en") as "en" | "th";
      setLanguage(nextLanguage);
      setNotificationsEnabled(m?.notifications_enabled !== false);
      void setAppLanguage(nextLanguage);
      setUsername(m?.username || "");
      setAvatarLocal("");

      patchUser({
        name: m?.name ?? null,
        email: m?.email ?? null,
        avatar: normalizeImageUri(m?.avatar),
      });

      profileSnapRef.current = {
        name: m?.name || "",
        phone: m?.phone || "",
        language: ((m?.language as any) || "en") as "en" | "th",
        username: m?.username || "",
      };
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("settings.load_profile_failed"));
    } finally {
      setLoadingMe(false);
    }
  };

  const loadPosts = async (q?: string) => {
    setLoadingPosts(true);
    try {
      const res = await client.query<MyPostsQueryData>({
        query: Q_MY_POSTS,
        variables: { q: q ?? "" },
        fetchPolicy: "network-only",
      });
      setPosts((res?.data?.myPosts || []).map((x: any) => ({ ...x, id: String(x.id) })));
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("settings.load_posts_failed"));
    } finally {
      setLoadingPosts(false);
    }
  };

  const loadBookmarks = async () => {
    setLoadingBookmarks(true);
    try {
      const res = await client.query<MyBookmarksQueryData>({ query: Q_MY_BOOKMARKS, fetchPolicy: "network-only" });
      setBookmarks((res?.data?.myBookmarks || []).map((x: any) => ({ ...x, id: String(x.id) })));
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("settings.load_bookmarks_failed"));
    } finally {
      setLoadingBookmarks(false);
    }
  };

  const refetchBookmarksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeBookmarkStatusChanged((e) => {
      if (e.target_type !== "POST") return;
      if (refetchBookmarksTimerRef.current != null) return;
      refetchBookmarksTimerRef.current = setTimeout(() => {
        refetchBookmarksTimerRef.current = null;
        void loadBookmarks();
      }, 250);
    });

    return () => {
      try {
        unsub();
      } catch {}
      try {
        if (refetchBookmarksTimerRef.current != null) {
          clearTimeout(refetchBookmarksTimerRef.current);
          refetchBookmarksTimerRef.current = null;
        }
      } catch {}
    };
    // Subscribe once per screen mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMe();
    loadPosts("");
    loadBookmarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Actions =====
  const onSaveProfile = async () => {
    if (!name.trim()) return Alert.alert(t("common.error"), t("settings.display_name"));

    try {
      setSavingMe(true);
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        language,
        notifications_enabled: notificationsEnabled,
        username: username.trim(),
      };

      const res = await client.mutate<UpdateMeMutationData>({ mutation: M_UPDATE_ME, variables: { data: payload } });
      const saved = res?.data?.updateMe ?? null;

      if (saved?.id) {
        Alert.alert(t("common.success"), t("settings.profile_saved"));
        setMe((prev) => ({ ...(prev || {}), ...saved }));
        patchUser({ name: saved.name ?? name.trim() });
        profileSnapRef.current = { ...payload };
        void setAppLanguage(language);
      } else {
        Alert.alert(t("common.error"), t("settings.save_failed"));
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("settings.save_error"));
    } finally {
      setSavingMe(false);
    }
  };

  const onToggleNotifications = async (next: boolean) => {
    if (!me?.id || updatingNotifications) return;

    const prev = notificationsEnabled;
    setNotificationsEnabled(next);
    setUpdatingNotifications(true);

    try {
      const res = await client.mutate<UpdateMeMutationData>({
        mutation: M_UPDATE_ME,
        variables: { data: { notifications_enabled: next } },
      });

      const saved = res?.data?.updateMe ?? null;
      if (!saved?.id) {
        throw new Error(t("settings.notification_update_failed"));
      }

      setMe((prevMe) => ({ ...(prevMe || {}), ...saved }));
      setNotificationsEnabled(saved.notifications_enabled !== false);
    } catch (e: any) {
      setNotificationsEnabled(prev);
      Alert.alert(t("common.error"), e?.message || t("settings.notification_update_failed"));
    } finally {
      setUpdatingNotifications(false);
    }
  };

  const onPickAndUploadAvatar = async () => {
    if (!me?.id) return Alert.alert(t("common.error"), t("settings.missing_user_id"));
    if (savingMe) return;

    const res = await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, quality: 0.9 });
    if (res.didCancel) return;
    if (res.errorCode) return Alert.alert(t("settings.pick_failed"), res.errorMessage || res.errorCode);

    const asset = res.assets?.[0];
    if (!asset?.uri) return Alert.alert(t("settings.pick_failed"), t("common.unknown_error"));

    setAvatarLocal(asset.uri);
    const file = toUploadFromAsset(asset);
    if (!file) return Alert.alert(t("common.error"), t("common.upload_failed"));

    try {
      setSavingMe(true);
      const up = await client.mutate<UploadAvatarMutationData>({ mutation: M_UPLOAD_AVATAR, variables: { user_id: me.id, file } });
      const url = up?.data?.uploadAvatar;

      if (url) {
        const nextAvatar = normalizeImageUri(String(url));
        const nextAvatarVersion = Date.now();

        setMe((prev) => (prev ? { ...prev, avatar: nextAvatar } : prev));
        setAvatarLocal("");
        setAvatarVersion(nextAvatarVersion);
        patchUser({ avatar: nextAvatar });

        try {
          const cached = client.readQuery<MeQueryData>({ query: Q_ME });
          if (cached?.me) {
            client.writeQuery<MeQueryData>({
              query: Q_ME,
              data: { me: { ...cached.me, avatar: nextAvatar } },
            });
          }
        } catch {}

        Alert.alert(t("common.success"), t("settings.avatar_updated"));
        void loadMe();
      } else {
        setAvatarLocal("");
        Alert.alert(t("common.error"), t("common.upload_failed"));
      }
    } catch (e: any) {
      setAvatarLocal("");
      Alert.alert(t("common.error"), e?.message || t("common.upload_failed"));
    } finally {
      setSavingMe(false);
    }
  };

  const onDeletePost = async (id: string) => {
    Alert.alert(t("common.confirm"), t("settings.delete_post_confirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            const res = await client.mutate<DeletePostMutationData>({ mutation: MUT_DEL_POST, variables: { id } });
            if (res?.data?.deletePost) setPosts((prev) => prev.filter((p) => p.id !== id));
            else Alert.alert(t("common.error"), t("settings.delete_failed"));
          } catch (e: any) {
            Alert.alert(t("common.error"), e?.message || t("settings.delete_failed"));
          }
        },
      },
    ]);
  };

  const onToggleBookmark = async (postId: string) => {
    try {
      const res = await client.mutate<ToggleBookmarkMutationData>({ mutation: M_TOGGLE_BOOKMARK, variables: { postId } });
      const ok = res?.data?.toggleBookmark?.ok;
      const is_bookmarked = res?.data?.toggleBookmark?.is_bookmarked;
      if (!ok) return Alert.alert(t("common.error"), t("settings.toggle_bookmark_failed"));

      setBookmarks((prev) => prev.map((b) => (b.id === postId ? { ...b, is_bookmarked } : b)));
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("settings.toggle_bookmark_error"));
    }
  };

  const onChangePassword = async () => {
    if (!currentPass) return Alert.alert(t("common.error"), t("settings.current_password_required"));
    if (newPass.length < 8) return Alert.alert(t("common.error"), t("settings.new_password_min"));
    if (newPass !== confirmPass) return Alert.alert(t("common.error"), t("settings.confirm_password_not_match"));

    try {
      setChangingPass(true);
      // TODO: ใส่ mutation เปลี่ยนรหัสผ่านของคุณที่นี่
      Alert.alert("TODO", t("settings.change_password_todo"));
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    } finally {
      setChangingPass(false);
    }
  };

  // ✅ Logout logic
  const performLogout = async () => {
    try {
      setLoggingOut(true);

      await logout();

      // reset navigation -> Home after centralized logout cleanup completes
      navigation.reset({
        index: 0,
        routes: [{ name: "ScamProtect" }],
      });
    } catch (e: any) {
      Alert.alert(t("settings.logout_failed"), e?.message || t("common.retry"));
    } finally {
      setLoggingOut(false);
    }
  };

  const onLogout = () => {
    if (profileDirty) {
      Alert.alert(
        t("settings.unsaved_changes"),
        t("settings.unsaved_changes_logout"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.logout"), style: "destructive", onPress: performLogout },
        ]
      );
      return;
    }

    Alert.alert(t("common.logout"), t("settings.logout_confirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.logout"), style: "destructive", onPress: performLogout },
    ]);
  };

  // ===== Header Right (Save / Change) =====
  useLayoutEffect(() => {
    const showSave = active === "profile";
    const showChange = active === "security";

    const disabled =
      (showSave && (!profileDirty || savingMe || loadingMe)) ||
      (showChange && !passwordReady);

    const label = showSave ? t("common.save") : showChange ? t("common.confirm") : "";
    const onPress = showSave ? onSaveProfile : showChange ? onChangePassword : undefined;

    navigation.setOptions({
      headerShown: true,
      title: t("settings.title"),
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerTitleStyle: { fontWeight: "900" },
      headerRight: !onPress
        ? undefined
        : () => (
            <Pressable
              onPress={onPress}
              disabled={disabled}
              style={[styles.headerActionBtn, disabled && { opacity: 0.45 }]}
              hitSlop={8}
            >
              {savingMe || changingPass ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.headerActionText}>{label}</Text>
              )}
            </Pressable>
          ),
    });
  }, [navigation, active, profileDirty, savingMe, loadingMe, passwordReady, changingPass, t]);

  // ================= Panels =================

  const renderProfile = () => (
    <View style={styles.card}>
      <SectionTitle>{t("settings.profile_account")}</SectionTitle>

      {loadingMe ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>{t("settings.loading_profile")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrap}>
              {displayAvatarUri ? (
                <Image key={displayAvatarUri} source={{ uri: displayAvatarUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>
                    {(me?.name || "U").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.bigName}>{me?.name || t("settings.user")}</Text>
              <Text style={styles.subText}>{maskEmail(me?.email)}</Text>
              <Text style={styles.subText}>{t("settings.role")}: {me?.role || "-"}</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <Pressable
                  style={[styles.outlineBtn]}
                  onPress={onPickAndUploadAvatar}
                  disabled={savingMe}
                >
                  <Text style={styles.outlineText}>{savingMe ? t("settings.uploading") : t("settings.upload_avatar")}</Text>
                </Pressable>

                {/* ✅ Logout button อยู่ที่ Profile (แนะนำที่สุด) */}
                <Pressable
                  style={[styles.dangerOutlineBtn]}
                  onPress={onLogout}
                  disabled={loggingOut}
                  accessibilityLabel="Logout"
                >
                  {loggingOut ? (
                    <ActivityIndicator />
                  ) : (
                    <Ionicons name="log-out-outline" size={22} color="#ff6b6b" />
                  )}
                </Pressable>
              </View>

              {profileDirty && (
                <Text style={[styles.hint, { marginTop: 8 }]}>
                  {t("settings.profile_dirty_hint")}
                </Text>
              )}
            </View>
          </View>

          <Divider />

          <Field label={t("settings.display_name")}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t("settings.display_name")}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
          </Field>

          <Field label={t("settings.phone")}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t("settings.phone")}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label={t("settings.email")}>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{me?.email || "-"}</Text>
            </View>
          </Field>

          <Field label={t("settings.username")}>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{me?.username || username || "-"}</Text>
            </View>
          </Field>

          <Field label={t("settings.language")}>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={language}
                onValueChange={(v) => {
                  const next = v as "en" | "th";
                  setLanguage(next);
                  void setAppLanguage(next);
                }}
                dropdownIconColor="#fff"
                style={styles.picker}
              >
                <Picker.Item label={t("settings.english")} value="en" />
                <Picker.Item label={t("settings.thai")} value="th" />
              </Picker>
            </View>
          </Field>

          <Field label={t("settings.notifications")} hint={t("settings.notifications_hint")}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{t("settings.enable_notifications")}</Text>
              {updatingNotifications ? (
                <ActivityIndicator />
              ) : (
                <Switch
                  value={notificationsEnabled}
                  onValueChange={onToggleNotifications}
                  disabled={loadingMe || savingMe || updatingNotifications}
                />
              )}
            </View>
          </Field>

          <Divider />

          <SectionTitle>{t("settings.contact_protection_title")}</SectionTitle>

          <Field label={t("settings.block_mode_title")} hint={t("settings.contact_protection_description")}>
            <View style={styles.pillsInlineWrap}>
              <Pill
                label={t("settings.block_mode_allow")}
                active={contactProtectionSettings.mode === "OFF"}
                onPress={() => {
                  setSavingContactProtection(true);
                  void updateContactProtectionSettings({ mode: "OFF" }).finally(() => setSavingContactProtection(false));
                }}
              />
              <Pill
                label={t("settings.block_mode_warn")}
                active={contactProtectionSettings.mode === "PROMPT"}
                onPress={() => {
                  setSavingContactProtection(true);
                  void updateContactProtectionSettings({ mode: "PROMPT" }).finally(() => setSavingContactProtection(false));
                }}
              />
              <Pill
                label={t("settings.block_mode_block")}
                active={contactProtectionSettings.mode === "AUTO"}
                onPress={() => {
                  setSavingContactProtection(true);
                  void updateContactProtectionSettings({ mode: "AUTO" }).finally(() => setSavingContactProtection(false));
                }}
              />
            </View>
          </Field>

          <Field label={t("settings.spam_warning_title")} hint={t("settings.spam_warning_description")}>
            <View style={styles.pillsInlineWrap}>
              {[55, 70, 85].map((value) => (
                <Pill
                  key={value}
                  label={String(value)}
                  active={contactProtectionSettings.riskThreshold === value}
                  onPress={() => {
                    setSavingContactProtection(true);
                    void updateContactProtectionSettings({ riskThreshold: value }).finally(() => setSavingContactProtection(false));
                  }}
                />
              ))}
            </View>
          </Field>

          <Field label={t("settings.contact_protection_sync_title")} hint={t("settings.contact_protection_sync_description")}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{t("settings.contact_protection_sync_toggle")}</Text>
              {loadingContactProtection || savingContactProtection ? (
                <ActivityIndicator />
              ) : (
                <Switch
                  value={contactProtectionSettings.syncEnabled}
                  onValueChange={(next) => {
                    setSavingContactProtection(true);
                    void updateContactProtectionSettings({ syncEnabled: next }).finally(() => setSavingContactProtection(false));
                  }}
                />
              )}
            </View>
          </Field>

          <Field label={t("settings.contact_protection_auto_mark_title")} hint={t("settings.contact_protection_auto_mark_description")}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{t("settings.contact_protection_auto_mark_toggle")}</Text>
              {loadingContactProtection || savingContactProtection ? (
                <ActivityIndicator />
              ) : (
                <Switch
                  value={contactProtectionSettings.autoMarkEnabled}
                  onValueChange={(next) => {
                    setSavingContactProtection(true);
                    void updateContactProtectionSettings({ autoMarkEnabled: next }).finally(() => setSavingContactProtection(false));
                  }}
                  disabled={contactProtectionSettings.mode !== "AUTO"}
                />
              )}
            </View>
          </Field>

          <Text style={styles.hint}>{t("settings.contact_protection_description")}</Text>

          {/* Save อยู่ที่ header แล้ว */}
        </>
      )}
    </View>
  );

  const renderPosts = () => (
    <View style={styles.card}>
      <SectionTitle>{t("settings.my_posts")}</SectionTitle>

      <View style={styles.searchRow}>
        <TextInput
          value={qPosts}
          onChangeText={setQPosts}
          placeholder={t("settings.search_title_detail")}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={[styles.input, { flex: 1 }]}
        />
        <Pressable style={[styles.outlineBtn, { width: 110 }]} onPress={() => loadPosts(qPosts)}>
          <Text style={styles.outlineText}>{t("common.search")}</Text>
        </Pressable>
      </View>

      {loadingPosts && (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>{t("settings.loading_posts")}</Text>
        </View>
      )}

      <Divider />

      {!loadingPosts && posts.length === 0 ? (
        <Text style={styles.emptyText}>{t("settings.no_posts")}</Text>
      ) : (
        posts.map((p) => (
          <View key={p.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{p.title}</Text>
              {!!p.detail && (
                <Text style={styles.itemDesc} numberOfLines={2}>
                  {p.detail}
                </Text>
              )}
              <Text style={styles.itemMeta}>
                {p.status} • {dayjs(p.created_at).format("DD/MM/YYYY HH:mm")}
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Pressable
                style={[styles.smallBtn, (!currentUserId || booting) && { opacity: 0.45 }]}
                disabled={!currentUserId || booting}
                onPress={() => {
                  const postId = String(p.id);
                  console.debug("[Settings] navigate PostView", {
                    postId,
                    currentUserId,
                    booting,
                  });

                  if (!currentUserId) {
                    Alert.alert(t("common.error"), t("settings.missing_user_id"));
                    return;
                  }

                  navigation.navigate("PostView", {
                    id: postId,
                    currentUserId,
                  });
                }}
              >
                <Text style={styles.smallBtnText}>{t("common.view")}</Text>
              </Pressable>

              <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={() => onDeletePost(p.id)}>
                <Text style={[styles.smallBtnText, { color: "#ff6b6b" }]}>{t("common.delete")}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );

  const renderBookmarks = () => (
    <View style={styles.card}>
      <SectionTitle>{t("settings.my_bookmarks")}</SectionTitle>

      <View style={styles.searchRow}>
        <Pressable style={[styles.outlineBtn, { width: 120 }]} onPress={loadBookmarks}>
          <Text style={styles.outlineText}>{t("common.refresh")}</Text>
        </Pressable>
      </View>

      {loadingBookmarks && (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>{t("settings.loading_bookmarks")}</Text>
        </View>
      )}

      <Divider />

      {!loadingBookmarks && bookmarks.length === 0 ? (
        <Text style={styles.emptyText}>{t("settings.no_bookmarks")}</Text>
      ) : (
        bookmarks.map((b) => (
          <View key={b.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{b.title}</Text>
              <Text style={styles.itemMeta}>
                {b.status} • {b.author?.name || "-"} • {dayjs(b.created_at).format("DD/MM/YYYY HH:mm")}
              </Text>
            </View>

            <Pressable
              style={[styles.smallBtn, b.is_bookmarked ? styles.bookmarked : null]}
              onPress={() => onToggleBookmark(b.id)}
            >
              <Text style={styles.smallBtnText}>{b.is_bookmarked ? t("settings.bookmarked") : t("settings.bookmark")}</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );

  const renderSecurity = () => (
    <View style={styles.card}>
      <SectionTitle>{t("settings.security")}</SectionTitle>

      <Field label={t("settings.current_password")}>
        <TextInput
          value={currentPass}
          onChangeText={setCurrentPass}
          placeholder={t("settings.current_password")}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Field label={t("settings.new_password")}>
        <TextInput
          value={newPass}
          onChangeText={setNewPass}
          placeholder={t("settings.new_password")}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Field label={t("settings.confirm_new_password")}>
        <TextInput
          value={confirmPass}
          onChangeText={setConfirmPass}
          placeholder={t("settings.confirm_new_password")}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Text style={styles.hint}>{t("settings.password_hint")}</Text>

      {hiddenDiag.enabled ? (
        <>
          <Divider />
          <Field label="Diagnostics" hint="Release-safe debug info (DB + blocker events)">
            <Pressable style={styles.smallBtn} onPress={() => navigation.navigate("Diagnostics")}>
              <Text style={styles.smallBtnText}>Open diagnostics</Text>
            </Pressable>
            <View style={{ height: 8 }} />
            <Pressable style={styles.smallBtn} onPress={() => navigation.navigate("DeveloperOptions")}>
              <Text style={styles.smallBtnText}>Open developer options</Text>
            </Pressable>
          </Field>
        </>
      ) : null}
    </View>
  );

  const content = useMemo(() => {
    if (active === "profile") return renderProfile();
    if (active === "posts") return renderPosts();
    if (active === "bookmarks") return renderBookmarks();
    return renderSecurity();
  }, [
    active,
    hiddenDiag.enabled,
    loadingMe,
    savingMe,
    loadingPosts,
    loadingBookmarks,
    me,
    name,
    phone,
    language,
    username,
    notificationsEnabled,
    updatingNotifications,
    qPosts,
    posts,
    bookmarks,
    currentPass,
    newPass,
    confirmPass,
    loggingOut,
    profileDirty,
  ]);

  return (
    <View style={styles.screen}>
      {/* Pills bar */}
      <View style={styles.pillsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsRowContent}>
          <Pill label={t("settings.profile")} active={active === "profile"} onPress={() => setActive("profile")} />
          <Pill label={t("settings.posts")} active={active === "posts"} onPress={() => setActive("posts")} />
          <Pill label={t("settings.bookmarks")} active={active === "bookmarks"} onPress={() => setActive("bookmarks")} />
          <Pill label={t("settings.security")} active={active === "security"} onPress={() => setActive("security")} />
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {content}
      </ScrollView>
    </View>
  );
}

// ================= Styles =================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0b" },

  headerActionBtn: {
    height: 34,
    // paddingHorizontal: 12,
    // borderRadius: 12,
    // borderWidth: 1,
    // borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    // marginRight: 10,
    minWidth: 72,
  },
  headerActionText: { color: "#fff", fontWeight: "900" },

  pillsBar: { height: 54, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  pillsRowContent: { alignItems: "center", paddingRight: 12 },
  pillsInlineWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  contentScroll: { flex: 1 },
  container: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
    justifyContent: "flex-start",
    alignItems: "stretch",
  },

  pill: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  pillActive: { backgroundColor: "#00e5ff", borderColor: "#00e5ff" },
  pillText: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },
  pillTextActive: { color: "#071014" },

  card: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#101010",
    borderRadius: 18,
    padding: 14,
    alignSelf: "stretch",
  },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginVertical: 12 },

  sectionTitle: { color: "#fff", fontWeight: "900", fontSize: 18, marginBottom: 10 },
  label: { color: "rgba(255,255,255,0.75)", marginBottom: 6, fontWeight: "800" },
  hint: { color: "rgba(255,255,255,0.5)", marginTop: 6, fontSize: 12 },

  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "white",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  readonlyBox: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    flexDirection: "row",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    opacity: 0.85,
  },
  readonlyText: { color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  pickerWrap: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#151515",
  },
  picker: { color: "white" },

  toggleRow: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleLabel: {
    color: "#fff",
    fontWeight: "700",
    flex: 1,
    paddingRight: 12,
  },

  outlineBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: "#111",
  },
  outlineText: { color: "white", fontWeight: "900" },

  // ✅ Logout button style
  dangerOutlineBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
    backgroundColor: "rgba(255,107,107,0.10)",
  },
  dangerOutlineText: { color: "#ff6b6b", fontWeight: "900" },

  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    marginTop: 10,
  },
  inlineLoadingText: { color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  emptyText: { color: "rgba(255,255,255,0.6)" },

  profileRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  avatarWrap: { width: 92, height: 92, borderRadius: 22, overflow: "hidden" },
  avatar: { width: 92, height: 92, borderRadius: 22, backgroundColor: "#222" },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { color: "#fff", fontWeight: "900", fontSize: 20 },

  bigName: { color: "#fff", fontWeight: "900", fontSize: 18 },
  subText: { color: "rgba(255,255,255,0.6)", marginTop: 2 },

  searchRow: { flexDirection: "row", gap: 10, alignItems: "center" },

  listItem: {
    flexDirection: "row",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#0f0f0f",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  itemTitle: { color: "#fff", fontWeight: "900" },
  itemDesc: { color: "rgba(255,255,255,0.65)", marginTop: 4 },
  itemMeta: { color: "rgba(255,255,255,0.45)", marginTop: 6, fontSize: 12 },

  smallBtn: {
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
  },
  smallBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  dangerBtn: { borderColor: "rgba(255,120,120,0.35)" },
  bookmarked: { backgroundColor: "rgba(0,229,255,0.18)", borderColor: "rgba(0,229,255,0.40)" },
});
