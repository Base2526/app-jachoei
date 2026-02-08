import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Alert,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { client } from "../apollo/client";
import type { RootStackParamList } from "../navigation/types";

import { useAuth } from "../auth/AuthProvider"

// ✅ ถ้าคุณมี useSessionCtx แบบเว็บ ให้เปลี่ยนเป็นระบบ auth ของ RN เอง
// ตัวอย่างนี้ทำเป็น currentUserId แบบ mock: ปรับให้ดึงจาก store/context ของคุณ
// import { useSessionCtx } from "../session/session-context";

// =======================
// Utils
// =======================
function maskEmailKeepLength(email?: string | null) {
  if (!email) return "";
  const s = String(email);
  const at = s.indexOf("@");
  if (at <= 1) return s;

  const name = s.slice(0, at);
  const domain = s.slice(at);
  if (name.length <= 2) return `${name[0]}*${domain}`;

  // keep length-ish: show first+last
  const masked = `${name[0]}${"*".repeat(Math.max(1, name.length - 2))}${name[name.length - 1]}`;
  return masked + domain;
}

function formatTs(ts?: string | number | null) {
  if (!ts) return "-";
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (!n || Number.isNaN(n)) return String(ts);
  return new Date(n).toLocaleString();
}

function statusColor(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (s === "PUBLIC" || s === "VERIFIED" || s === "OK") return { bg: "#0b3d2e", fg: "#34c759" };
  if (s === "PENDING") return { bg: "#3a2a00", fg: "#fbbf24" };
  if (s === "BLOCKED" || s === "BANNED") return { bg: "#3a0a0a", fg: "#ff453a" };
  return { bg: "#1f2937", fg: "#cbd5e1" };
}

// =======================
// GraphQL
// =======================
const Q_PROFILE = gql`
  query($id: ID!) {
    user(id: $id) {
      id
      name
      avatar
      phone
      email
      role
      created_at
    }
    postsByUserId(user_id: $id) {
      id
      title
      status
      created_at
      tel_numbers {
        id
        tel
      }
    }
  }
`;

type UserRecord = {
  id: string;
  name?: string | null;
  avatar?: string | null;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
  created_at?: string | null;
};

type PostItem = {
  id: string;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
  tel_numbers?: { id: string; tel: string }[];
};

type ProfileQueryData = {
  user: UserRecord | null;
  postsByUserId: PostItem[];
};

type ProfileQueryVars = { id: string };

// =======================
// Screen
// =======================
type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export const ProfileScreen: React.FC<Props> = ({ route, navigation }) => {
  const id = route.params?.id;

  const { isLoggedIn, user, logout } = useAuth();

  // ✅ ปรับให้ดึงจาก auth ของคุณเอง
  // const { user } = useSessionCtx();
  // const currentUserId: string | undefined = undefined;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [u, setU] = useState<UserRecord | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);

  const isMe = useMemo(() => !!user?.id && !!u?.id && user?.id === u.id, [user?.id, u?.id]);

  const load = useCallback(async () => {
    if (!id) {
      setErrorMsg("Missing user id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await client.query<ProfileQueryData, ProfileQueryVars>({
        query: Q_PROFILE,
        variables: { id },
        fetchPolicy: "network-only",
      });

      setU(res.data?.user ?? null);
      setPosts(res.data?.postsByUserId ?? []);
    } catch (e: any) {
      setErrorMsg(e?.message || "Load failed");
      setU(null);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "User Profile",
      headerStyle: { backgroundColor: "#111" },
      headerTintColor: "#fff",
      headerTitleStyle: { fontWeight: "800" },
      headerRight: () => {
        if (!u?.id) return null;
        if (isMe) return null;

        return (
          <Pressable
            onPress={() => {
              // ✅ ปรับ route ชื่อ "Chat" ให้ตรงของคุณ
              navigation.navigate("Chat", { to: u.id });
            }}
            hitSlop={10}
            style={{ paddingHorizontal: 10 }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={22} color="#fff" />
          </Pressable>
        );
      },
    });
  }, [navigation, u?.id, isMe]);

  const onOpenPost = useCallback(
    (p: PostItem) => {
      // ✅ ปรับ route ชื่อ "PostView" ให้ตรงของคุณ
      navigation.navigate("PostView", { post: p as any });
    },
    [navigation]
  );

  const renderPostItem = useCallback(
    ({ item }: { item: PostItem }) => {
      const firstTel = item.tel_numbers?.length ? item.tel_numbers[0]?.tel : "-";
      const sc = statusColor(item.status);

      return (
        <Pressable onPress={() => onOpenPost(item)} style={styles.postCard}>
          <View style={styles.postTop}>
            <Text style={styles.postTitle} numberOfLines={2}>
              {item.title || "-"}
            </Text>

            {!!item.status && (
              <View style={[styles.tag, { backgroundColor: sc.bg }]}>
                <Text style={[styles.tagText, { color: sc.fg }]} numberOfLines={1}>
                  {String(item.status).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.postMeta} numberOfLines={1}>
            Phone: {firstTel}
          </Text>

          <Text style={styles.postMeta2} numberOfLines={1}>
            Created at: {formatTs(item.created_at)}
          </Text>

          <View style={styles.postChevron}>
            <Ionicons name="chevron-forward" size={18} color="#64748b" />
          </View>
        </Pressable>
      );
    },
    [onOpenPost]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.centerText}>Loading...</Text>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={styles.center}>
        <Text style={[styles.centerText, { color: "#ff453a" }]}>{errorMsg}</Text>
        <Pressable onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!u) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>User not found</Text>
      </View>
    );
  }

  const initial = (u.name || "U").trim().slice(0, 1).toUpperCase();

  return (
    <View style={styles.container}>
      {/* ===== Profile Card ===== */}
      <View style={styles.profileCard}>
        <View style={styles.profileTop}>
          <View style={styles.avatarWrap}>
            {u.avatar ? (
              <Image source={{ uri: u.avatar }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>{initial}</Text>
              </View>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {u.name || "-"}
            </Text>

            <Text style={styles.subText} numberOfLines={1}>
              {maskEmailKeepLength(u.email) || "-"}
            </Text>

            <View style={styles.roleRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#9ca3af" />
              <Text style={styles.roleText}>{u.role || "-"}</Text>
            </View>
          </View>

          {!isMe && (
            <Pressable
              onPress={() => {
                if(isLoggedIn)
                  navigation.navigate("Chat", { to: u.id })
                else
                  navigation.navigate("SignIn");
              }}
              style={styles.chatBtn}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#111" />
              <Text style={styles.chatBtnText}>Chat</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.profileInfo}>
          <InfoRow label="Phone" value={u.phone || "-"} />
          <InfoRow label="Joined" value={formatTs(u.created_at)} />
        </View>
      </View>

      {/* ===== Posts List ===== */}
      <View style={styles.postsHeader}>
        <Text style={styles.postsTitle}>Posts by this user</Text>
        <Text style={styles.postsCount}>{posts.length}</Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderPostItem}
        contentContainerStyle={posts.length === 0 ? styles.emptyWrap : { paddingBottom: 16 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No posts</Text>}
      />
    </View>
  );
};

// =======================
// Small component
// =======================
const InfoRow = ({ label, value }: { label: string; value: string }) => {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};

// =======================
// Styles
// =======================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    padding: 12,
  },

  center: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  centerText: {
    color: "#cbd5e1",
    marginTop: 10,
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: "#1e90ff",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: { color: "#fff", fontWeight: "800" },

  profileCard: {
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 56,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarFallbackText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 18,
  },

  name: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 16,
  },
  subText: {
    color: "#9ca3af",
    marginTop: 2,
    fontSize: 12,
  },

  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  roleText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },

  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#34c759",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  chatBtnText: {
    color: "#111",
    fontWeight: "900",
    fontSize: 12,
  },

  profileInfo: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#222",
    paddingTop: 10,
    gap: 8,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  infoLabel: {
    width: 70,
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
  },
  infoValue: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  postsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  postsTitle: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  postsCount: {
    color: "#9ca3af",
    fontWeight: "800",
    fontSize: 12,
  },

  postCard: {
    backgroundColor: "#0f1117",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    position: "relative",
  },
  postTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  postTitle: {
    flex: 1,
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "900",
  },

  postMeta: {
    color: "#cbd5e1",
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
  },
  postMeta2: {
    color: "#64748b",
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
  },

  postChevron: {
    position: "absolute",
    right: 10,
    bottom: 10,
  },

  emptyWrap: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
  },
  emptyText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "700",
  },
});

export default ProfileScreen;