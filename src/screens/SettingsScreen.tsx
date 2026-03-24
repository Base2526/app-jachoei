// SettingsScreen.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Picker } from "@react-native-picker/picker";
import dayjs from "dayjs";
import { launchImageLibrary, Asset } from "react-native-image-picker";
import { gql } from "@apollo/client";
import AsyncStorage from "@react-native-async-storage/async-storage"; // ถ้าไม่ใช้ ลบได้
import { client } from "../apollo/client";

import { subscribeBookmarkStatusChanged } from "../events/bookmarkSync";


import { useAuth } from "../auth/AuthProvider";

// ================= GraphQL =================

type Me = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  username?: string;
  language?: "en" | "th";
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

const Q_ME = gql`
  query {
    me {
      id
      name
      email
      phone
      username
      language
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
  const [active, setActive] = useState<MenuKey>("profile");

  // Me/Profile
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [savingMe, setSavingMe] = useState(false);

  const [avatarLocal, setAvatarLocal] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<"en" | "th">("en");
  const [username, setUsername] = useState("");

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

  const { logout, user, booting } = useAuth();

  const currentUserId = useMemo(() => {
    const id = user?.id;
    return id ? String(id) : null;
  }, [user?.id]);

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
      const res = await client.query({ query: Q_ME, fetchPolicy: "network-only" });
      const m: Me = res?.data?.me;

      setMe(m || null);
      setName(m?.name || "");
      setPhone(m?.phone || "");
      setLanguage((m?.language as any) || "en");
      setUsername(m?.username || "");
      setAvatarLocal("");

      profileSnapRef.current = {
        name: m?.name || "",
        phone: m?.phone || "",
        language: ((m?.language as any) || "en") as "en" | "th",
        username: m?.username || "",
      };
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Load profile failed");
    } finally {
      setLoadingMe(false);
    }
  };

  const loadPosts = async (q?: string) => {
    setLoadingPosts(true);
    try {
      const res = await client.query({
        query: Q_MY_POSTS,
        variables: { q: q ?? "" },
        fetchPolicy: "network-only",
      });
      setPosts((res?.data?.myPosts || []).map((x: any) => ({ ...x, id: String(x.id) })));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Load posts failed");
    } finally {
      setLoadingPosts(false);
    }
  };

  const loadBookmarks = async () => {
    setLoadingBookmarks(true);
    try {
      const res = await client.query({ query: Q_MY_BOOKMARKS, fetchPolicy: "network-only" });
      setBookmarks((res?.data?.myBookmarks || []).map((x: any) => ({ ...x, id: String(x.id) })));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Load bookmarks failed");
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
    if (!name.trim()) return Alert.alert("กรุณากรอก", "Display name");

    try {
      setSavingMe(true);
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        language,
        username: username.trim(),
      };

      const res = await client.mutate({ mutation: M_UPDATE_ME, variables: { data: payload } });
      const saved: Me = res?.data?.updateMe;

      if (saved?.id) {
        Alert.alert("Saved", "Profile & Account saved");
        setMe((prev) => ({ ...(prev || {}), ...saved }));
        profileSnapRef.current = { ...payload };
      } else {
        Alert.alert("Error", "Save failed");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Save error");
    } finally {
      setSavingMe(false);
    }
  };

  const onPickAndUploadAvatar = async () => {
    if (!me?.id) return Alert.alert("Error", "Missing user id");

    const res = await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, quality: 0.9 });
    if (res.didCancel) return;
    if (res.errorCode) return Alert.alert("Pick failed", res.errorMessage || res.errorCode);

    const asset = res.assets?.[0];
    if (!asset?.uri) return Alert.alert("Pick failed", "No image selected");

    setAvatarLocal(asset.uri);
    const file = toUploadFromAsset(asset);
    if (!file) return Alert.alert("Error", "Invalid image file");

    try {
      setSavingMe(true);
      const up = await client.mutate({ mutation: M_UPLOAD_AVATAR, variables: { user_id: me.id, file } });
      const url = up?.data?.uploadAvatar;

      if (url) {
        Alert.alert("Success", "Avatar updated");
        await loadMe();
      } else {
        Alert.alert("Error", "Upload failed");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Upload failed");
    } finally {
      setSavingMe(false);
    }
  };

  const onDeletePost = async (id: string) => {
    Alert.alert("Confirm", "Delete this post?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await client.mutate({ mutation: MUT_DEL_POST, variables: { id } });
            if (res?.data?.deletePost) setPosts((prev) => prev.filter((p) => p.id !== id));
            else Alert.alert("Error", "Delete failed");
          } catch (e: any) {
            Alert.alert("Error", e?.message || "Delete error");
          }
        },
      },
    ]);
  };

  const onToggleBookmark = async (postId: string) => {
    try {
      const res = await client.mutate({ mutation: M_TOGGLE_BOOKMARK, variables: { postId } });
      const ok = res?.data?.toggleBookmark?.ok;
      const is_bookmarked = res?.data?.toggleBookmark?.is_bookmarked;
      if (!ok) return Alert.alert("Error", "Toggle bookmark failed");

      setBookmarks((prev) => prev.map((b) => (b.id === postId ? { ...b, is_bookmarked } : b)));
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Toggle bookmark error");
    }
  };

  const onChangePassword = async () => {
    if (!currentPass) return Alert.alert("กรุณากรอก", "Current password");
    if (newPass.length < 8) return Alert.alert("กรุณากรอก", "New password อย่างน้อย 8 ตัว");
    if (newPass !== confirmPass) return Alert.alert("ไม่ตรงกัน", "Confirm password ไม่ตรงกัน");

    try {
      setChangingPass(true);
      // TODO: ใส่ mutation เปลี่ยนรหัสผ่านของคุณที่นี่
      Alert.alert("TODO", "เสียบ mutation เปลี่ยนรหัสผ่านของ backend ได้ที่นี่");
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

      logout();

      // 1) clear local storage/token (ปรับ key ให้ตรงของคุณ)
      await AsyncStorage.multiRemove([
        "access_token",
        "refresh_token",
        "session",
        "user",
      ]);

      // 2) clear apollo cache
      try {
        await client.clearStore();
      } catch {}

      // 3) reset navigation -> Home
      navigation.replace("ScamProtect");
    } catch (e: any) {
      Alert.alert("Logout failed", e?.message || "Please try again");
    } finally {
      setLoggingOut(false);
    }
  };

  const onLogout = () => {
    if (profileDirty) {
      Alert.alert(
        "Unsaved changes",
        "คุณมีข้อมูลที่ยังไม่กด Save ต้องการ Logout เลยไหม?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Logout", style: "destructive", onPress: performLogout },
        ]
      );
      return;
    }

    Alert.alert("Logout", "ต้องการออกจากระบบใช่ไหม?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: performLogout },
    ]);
  };

  // ===== Header Right (Save / Change) =====
  useLayoutEffect(() => {
    const showSave = active === "profile";
    const showChange = active === "security";

    const disabled =
      (showSave && (!profileDirty || savingMe || loadingMe)) ||
      (showChange && !passwordReady);

    const label = showSave ? "Save" : showChange ? "Change" : "";
    const onPress = showSave ? onSaveProfile : showChange ? onChangePassword : undefined;

    navigation.setOptions({
      headerShown: true,
      title: "Settings",
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
  }, [navigation, active, profileDirty, savingMe, loadingMe, passwordReady, changingPass]);

  // ================= Panels =================

  const renderProfile = () => (
    <View style={styles.card}>
      <SectionTitle>Profile & Account</SectionTitle>

      {loadingMe ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>Loading profile…</Text>
        </View>
      ) : (
        <>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrap}>
              {avatarLocal || me?.avatar ? (
                <Image source={{ uri: avatarLocal || (me?.avatar as string) }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>
                    {(me?.name || "U").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.bigName}>{me?.name || "User"}</Text>
              <Text style={styles.subText}>{maskEmail(me?.email)}</Text>
              <Text style={styles.subText}>Role: {me?.role || "-"}</Text>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <Pressable
                  style={[styles.outlineBtn]}
                  onPress={onPickAndUploadAvatar}
                  disabled={savingMe}
                >
                  <Text style={styles.outlineText}>{savingMe ? "Uploading…" : "Upload Avatar"}</Text>
                </Pressable>

                {/* ✅ Logout button อยู่ที่ Profile (แนะนำที่สุด) */}
                <Pressable
                  style={[styles.dangerOutlineBtn]}
                  onPress={onLogout}
                  disabled={loggingOut}
                >
                  {loggingOut ? (
                    <ActivityIndicator />
                  ) : (
                    <Text style={styles.dangerOutlineText}>Logout</Text>
                  )}
                </Pressable>
              </View>

              {profileDirty && (
                <Text style={[styles.hint, { marginTop: 8 }]}>
                  * You have unsaved changes (กด Save ที่มุมขวาบน)
                </Text>
              )}
            </View>
          </View>

          <Divider />

          <Field label="Display name">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
            />
          </Field>

          <Field label="Phone">
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Your phone"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Email">
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{me?.email || "-"}</Text>
            </View>
          </Field>

          <Field label="Username">
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{me?.username || username || "-"}</Text>
            </View>
          </Field>

          <Field label="Language">
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={language}
                onValueChange={(v) => setLanguage(v)}
                dropdownIconColor="#fff"
                style={styles.picker}
              >
                <Picker.Item label="English" value="en" />
                <Picker.Item label="ไทย" value="th" />
              </Picker>
            </View>
          </Field>

          {/* Save อยู่ที่ header แล้ว */}
        </>
      )}
    </View>
  );

  const renderPosts = () => (
    <View style={styles.card}>
      <SectionTitle>My Posts</SectionTitle>

      <View style={styles.searchRow}>
        <TextInput
          value={qPosts}
          onChangeText={setQPosts}
          placeholder="Search title/detail"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={[styles.input, { flex: 1 }]}
        />
        <Pressable style={[styles.outlineBtn, { width: 110 }]} onPress={() => loadPosts(qPosts)}>
          <Text style={styles.outlineText}>Search</Text>
        </Pressable>
      </View>

      {loadingPosts && (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>Loading posts…</Text>
        </View>
      )}

      <Divider />

      {!loadingPosts && posts.length === 0 ? (
        <Text style={styles.emptyText}>No posts</Text>
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
                    Alert.alert("Error", "Missing user id. Please login again.");
                    return;
                  }

                  navigation.navigate("PostView", {
                    id: postId,
                    currentUserId,
                  });
                }}
              >
                <Text style={styles.smallBtnText}>View</Text>
              </Pressable>

              <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={() => onDeletePost(p.id)}>
                <Text style={[styles.smallBtnText, { color: "#ff6b6b" }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );

  const renderBookmarks = () => (
    <View style={styles.card}>
      <SectionTitle>My Bookmarks</SectionTitle>

      <View style={styles.searchRow}>
        <Pressable style={[styles.outlineBtn, { width: 120 }]} onPress={loadBookmarks}>
          <Text style={styles.outlineText}>Refresh</Text>
        </Pressable>
      </View>

      {loadingBookmarks && (
        <View style={styles.inlineLoading}>
          <ActivityIndicator />
          <Text style={styles.inlineLoadingText}>Loading bookmarks…</Text>
        </View>
      )}

      <Divider />

      {!loadingBookmarks && bookmarks.length === 0 ? (
        <Text style={styles.emptyText}>No bookmarks</Text>
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
              <Text style={styles.smallBtnText}>{b.is_bookmarked ? "Bookmarked" : "Bookmark"}</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );

  const renderSecurity = () => (
    <View style={styles.card}>
      <SectionTitle>Security</SectionTitle>

      <Field label="Current password">
        <TextInput
          value={currentPass}
          onChangeText={setCurrentPass}
          placeholder="Current password"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Field label="New password (min 8)">
        <TextInput
          value={newPass}
          onChangeText={setNewPass}
          placeholder="New password"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Field label="Confirm new password">
        <TextInput
          value={confirmPass}
          onChangeText={setConfirmPass}
          placeholder="Confirm"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          secureTextEntry
        />
      </Field>

      <Text style={styles.hint}>
        * กด Change ที่มุมขวาบน (ต้องกรอกครบ + new pass ≥ 8 และ confirm ตรงกัน)
      </Text>
    </View>
  );

  const content = useMemo(() => {
    if (active === "profile") return renderProfile();
    if (active === "posts") return renderPosts();
    if (active === "bookmarks") return renderBookmarks();
    return renderSecurity();
  }, [
    active,
    loadingMe,
    savingMe,
    loadingPosts,
    loadingBookmarks,
    me,
    name,
    phone,
    language,
    username,
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
          <Pill label="Profile" active={active === "profile"} onPress={() => setActive("profile")} />
          <Pill label="Posts" active={active === "posts"} onPress={() => setActive("posts")} />
          <Pill label="Bookmarks" active={active === "bookmarks"} onPress={() => setActive("bookmarks")} />
          <Pill label="Security" active={active === "security"} onPress={() => setActive("security")} />
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
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
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
