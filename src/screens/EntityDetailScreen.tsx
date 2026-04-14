import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { gql } from "@apollo/client";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { client } from "../apollo/client";
import { useAuth } from "../auth/AuthProvider";
import { BlockReportBottomSheet, type BlockReportBottomSheetRef } from "../components/BlockReportBottomSheet";
import { ActionIconButton } from "../components/ActionIconButton";
import type { RootStackParamList } from "../navigation/types";
import { usePhoneActions } from "../hooks/usePhoneActions";

const Q_PHONE_DETAIL = gql`
  query PhoneDetail($phone: String!) {
    phoneDetail(phone: $phone) {
      phone
      phone_normalized
      my_blocked
      my_blocked_at
      my_reported
      my_reported_at
      in_history
      last_history_at
      report_count
      last_report_at
      risk_level
      updated_at
      post_count
      latest_post_id
      post_ids
      filters
    }
  }
`;

const Q_BANK_DETAIL = gql`
  query BankDetail($bankCode: String!, $accountNo: String!) {
    bankDetail(bankCode: $bankCode, accountNo: $accountNo) {
      bank_code
      bank_name
      account
      report_count
      last_report_at
      risk_level
      updated_at
      post_count
      latest_post_id
      post_ids
      is_reported
      tags
    }
  }
`;

const Q_RELATED_POSTS_BY_PHONE = gql`
  query RelatedPostsByPhone($phone: String!, $sort: RelatedPostsSort!) {
    relatedPostsByPhone(phone: $phone, sort: $sort)
  }
`;

const Q_RELATED_POSTS_BY_BANK = gql`
  query RelatedPostsByBank($bankCode: String!, $accountNo: String!, $sort: RelatedPostsSort!) {
    relatedPostsByBank(bankCode: $bankCode, accountNo: $accountNo, sort: $sort)
  }
`;

const Q_POST_PREVIEW = gql`
  query RelatedPostPreview($id: ID!) {
    post(id: $id) {
      id
      title
      detail
      created_at
      images {
        id
        url
      }
      author {
        id
        name
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
    }
  }
`;

const M_REPORT_BANK = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      updated_at
      post_ids
    }
  }
`;

type SortValue = "LATEST" | "HIGHEST_RISK" | "MOST_REPORTED";

type PhoneDetail = {
  phone: string;
  phone_normalized: string;
  my_blocked: boolean;
  my_reported: boolean;
  in_history: boolean;
  report_count: number;
  risk_level: number;
  updated_at: string;
  last_report_at: string | null;
  post_count: number;
  latest_post_id: string | null;
  post_ids: string[];
};

type BankDetail = {
  bank_code: string;
  bank_name: string;
  account: string;
  report_count: number;
  risk_level: number;
  updated_at: string;
  last_report_at: string | null;
  post_count: number;
  latest_post_id: string | null;
  post_ids: string[];
  is_reported: boolean;
};

type RelatedPost = {
  id: string;
  title?: string | null;
  detail?: string | null;
  created_at: string;
  images?: Array<{ id: string; url: string }>;
  author?: { id: string; name?: string | null } | null;
  tel_numbers?: Array<{ id: string; tel: string }>;
  seller_accounts?: Array<{ id: string; bank_name?: string | null; seller_account?: string | null }>;
};

type Props = NativeStackScreenProps<RootStackParamList, "EntityDetail">;

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function riskTone(risk: number) {
  if (risk >= 75) return { label: "High", fg: "#fca5a5", bg: "rgba(239, 68, 68, 0.18)" };
  if (risk >= 40) return { label: "Medium", fg: "#fde68a", bg: "rgba(245, 158, 11, 0.18)" };
  return { label: "Low", fg: "#86efac", bg: "rgba(34, 197, 94, 0.16)" };
}

async function loadRelatedPosts(postIds: string[]) {
  const items = await Promise.all(
    postIds.map(async (id) => {
      const res = await client.query<{ post: RelatedPost | null }>({
        query: Q_POST_PREVIEW,
        variables: { id },
        fetchPolicy: "network-only",
      });
      return res.data?.post ?? null;
    })
  );

  return items.filter((item): item is RelatedPost => !!item);
}

export const EntityDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const params = route.params;
  const { user, isLoggedIn } = useAuth();
  const { blockPhone, reportPhone, unblockPhone } = usePhoneActions();
  const reportSheetRef = useRef<BlockReportBottomSheetRef>(null);

  const [sort, setSort] = useState<SortValue>("LATEST");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phoneDetail, setPhoneDetail] = useState<PhoneDetail | null>(null);
  const [bankDetail, setBankDetail] = useState<BankDetail | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<RelatedPost[]>([]);
  const [bankReporting, setBankReporting] = useState(false);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  const title = useMemo(() => {
    if (params.entityType === "PHONE") {
      return phoneDetail?.phone || params.phone;
    }
    return bankDetail?.bank_name || params.bankName || params.bankCode;
  }, [bankDetail?.bank_name, params, phoneDetail?.phone]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: params.entityType === "PHONE" ? "Phone details" : "Bank details",
    });
  }, [navigation, params.entityType]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      try {
        if (params.entityType === "PHONE") {
          const [detailRes, idsRes] = await Promise.all([
            client.query<{ phoneDetail: PhoneDetail }>({
              query: Q_PHONE_DETAIL,
              variables: { phone: params.phone },
              fetchPolicy: "network-only",
            }),
            client.query<{ relatedPostsByPhone: string[] }>({
              query: Q_RELATED_POSTS_BY_PHONE,
              variables: { phone: params.phone, sort },
              fetchPolicy: "network-only",
            }),
          ]);

          const posts = await loadRelatedPosts(detailRes.data?.phoneDetail?.post_count ? idsRes.data?.relatedPostsByPhone ?? [] : []);
          if (!active) return;
          setPhoneDetail(detailRes.data?.phoneDetail ?? null);
          setBankDetail(null);
          setRelatedPosts(posts);
        } else {
          const [detailRes, idsRes] = await Promise.all([
            client.query<{ bankDetail: BankDetail }>({
              query: Q_BANK_DETAIL,
              variables: { bankCode: params.bankCode, accountNo: params.accountNo },
              fetchPolicy: "network-only",
            }),
            client.query<{ relatedPostsByBank: string[] }>({
              query: Q_RELATED_POSTS_BY_BANK,
              variables: { bankCode: params.bankCode, accountNo: params.accountNo, sort },
              fetchPolicy: "network-only",
            }),
          ]);

          const posts = await loadRelatedPosts(detailRes.data?.bankDetail?.post_count ? idsRes.data?.relatedPostsByBank ?? [] : []);
          if (!active) return;
          setBankDetail(detailRes.data?.bankDetail ?? null);
          setPhoneDetail(null);
          setRelatedPosts(posts);
        }
      } catch (error: any) {
        if (!active) return;
        Alert.alert("Error", error?.message || "Unable to load details");
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [params, refreshKey, sort]);

  const onOpenPost = useCallback(
    (postId: string) => {
      navigation.navigate("PostView", { id: postId, currentUserId: user?.id });
    },
    [navigation, user?.id]
  );

  const onShareEntity = useCallback(async () => {
    const message =
      params.entityType === "PHONE"
        ? `Phone: ${phoneDetail?.phone || params.phone}\nRisk: ${phoneDetail?.risk_level ?? 0}\nReports: ${phoneDetail?.report_count ?? 0}`
        : `Bank: ${bankDetail?.bank_name || params.bankCode}\nAccount: ${bankDetail?.account || params.accountNo}\nRisk: ${bankDetail?.risk_level ?? 0}\nReports: ${bankDetail?.report_count ?? 0}`;
    await Share.share({ message });
  }, [bankDetail, params, phoneDetail]);

  const onPhoneBlockToggle = useCallback(async () => {
    if (!phoneDetail) return;
    try {
      if (phoneDetail.my_blocked) {
        await unblockPhone({ phone: phoneDetail.phone_normalized, source: "phone_center_card", rawPhone: phoneDetail.phone });
      } else {
        await blockPhone({ phone: phoneDetail.phone_normalized, source: "phone_center_card", rawPhone: phoneDetail.phone });
      }
      refresh();
    } catch (error: any) {
      Alert.alert("Action failed", error?.message || "Please try again");
    }
  }, [blockPhone, phoneDetail, refresh, unblockPhone]);

  const onPhoneReport = useCallback(() => {
    if (!phoneDetail) return;
    reportSheetRef.current?.open({ mode: "report", phone: phoneDetail.phone, title: "Report number" });
  }, [phoneDetail]);

  const onBankReport = useCallback(async () => {
    if (!bankDetail) return;
    if (!isLoggedIn) {
      navigation.navigate("SignIn");
      return;
    }

    setBankReporting(true);
    try {
      await client.mutate({
        mutation: M_REPORT_BANK,
        variables: {
          input: {
            bank_name: bankDetail.bank_name,
            account: bankDetail.account,
            note: null,
            client_id: `entity-${Date.now()}-${Math.round(Math.random() * 100000)}`,
            device_model: null,
            os_version: `${Platform.OS} ${Platform.Version}`,
            app_version: null,
          },
        },
      });
      refresh();
    } catch (error: any) {
      Alert.alert("Report failed", error?.message || "Please try again");
    } finally {
      setBankReporting(false);
    }
  }, [bankDetail, isLoggedIn, navigation, refresh]);

  const tone = riskTone(phoneDetail?.risk_level ?? bankDetail?.risk_level ?? 0);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>
                  {params.entityType === "PHONE"
                    ? phoneDetail?.phone_normalized || params.phone
                    : `${bankDetail?.bank_name || params.bankCode} • ${bankDetail?.account || params.accountNo}`}
                </Text>
              </View>
              <View style={[styles.riskPill, { backgroundColor: tone.bg }]}> 
                <Text style={[styles.riskPillText, { color: tone.fg }]}>{tone.label}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Risk</Text>
                <Text style={styles.statValue}>{phoneDetail?.risk_level ?? bankDetail?.risk_level ?? 0}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Reports</Text>
                <Text style={styles.statValue}>{phoneDetail?.report_count ?? bankDetail?.report_count ?? 0}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Posts</Text>
                <Text style={styles.statValue}>{phoneDetail?.post_count ?? bankDetail?.post_count ?? 0}</Text>
              </View>
            </View>

            <Text style={styles.metaText}>Last report: {formatDate(phoneDetail?.last_report_at ?? bankDetail?.last_report_at ?? null)}</Text>
            <Text style={styles.metaText}>Updated: {formatDate(phoneDetail?.updated_at ?? bankDetail?.updated_at ?? null)}</Text>

            <View style={styles.actionsRow}>
              {params.entityType === "PHONE" ? (
                <ActionIconButton
                  icon={phoneDetail?.my_blocked ? "lock-open-outline" : "lock-closed-outline"}
                  label={phoneDetail?.my_blocked ? "Unblock" : "Block"}
                  variant={phoneDetail?.my_blocked ? "success" : "accent"}
                  onPress={onPhoneBlockToggle}
                  accessibilityLabel={phoneDetail?.my_blocked ? "Unblock number" : "Block number"}
                />
              ) : null}
              <ActionIconButton
                icon="warning-outline"
                label="Report"
                variant="warning"
                onPress={params.entityType === "PHONE" ? onPhoneReport : onBankReport}
                busy={bankReporting}
                accessibilityLabel="Report entity"
              />
              <ActionIconButton
                icon="share-outline"
                label="Share"
                variant="accent"
                onPress={() => void onShareEntity()}
                accessibilityLabel="Share entity"
              />
            </View>
          </View>

          <View style={styles.sortRow}>
            {(["LATEST", "HIGHEST_RISK", "MOST_REPORTED"] as SortValue[]).map((value) => {
              const active = sort === value;
              return (
                <Pressable key={value} onPress={() => setSort(value)} style={[styles.sortPill, active && styles.sortPillActive]}>
                  <Text style={[styles.sortPillText, active && styles.sortPillTextActive]}>{value.replace(/_/g, " ")}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Related posts</Text>

          {relatedPosts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No related posts found.</Text>
            </View>
          ) : (
            <FlatList
              data={relatedPosts}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              renderItem={({ item }) => (
                <Pressable onPress={() => onOpenPost(item.id)} style={styles.postCard}>
                  <View style={styles.postBody}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.postTitle} numberOfLines={2}>{item.title || "Untitled post"}</Text>
                      <Text style={styles.postMeta} numberOfLines={1}>
                        {(item.author?.name || "Unknown user")} • {formatDate(item.created_at)}
                      </Text>
                      {item.detail ? (
                        <Text style={styles.postDetail} numberOfLines={3}>{item.detail}</Text>
                      ) : null}
                      <Text style={styles.postLink}>
                        {item.tel_numbers?.length || 0} TEL • {item.seller_accounts?.length || 0} BANK
                      </Text>
                    </View>

                    {item.images?.[0]?.url ? (
                      <Image source={{ uri: item.images[0].url }} style={styles.postThumb} resizeMode="cover" />
                    ) : null}
                  </View>
                </Pressable>
              )}
            />
          )}
        </ScrollView>
      )}

      <BlockReportBottomSheet
        ref={reportSheetRef}
        onCheck={() => undefined}
        onBlock={async () => undefined}
        onReport={async ({ phone, category, note }) => {
          await reportPhone({ phone, category, note, source: "phone_center_card", rawPhone: phone });
          refresh();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f19" },
  loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 28 },
  summaryCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1b2538",
    padding: 16,
  },
  summaryHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { color: "#f8fafc", fontSize: 20, fontWeight: "900" },
  subtitle: { color: "#94a3b8", marginTop: 6 },
  riskPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  riskPillText: { fontSize: 11, fontWeight: "900" },
  statsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  statCard: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1b2538",
    padding: 12,
  },
  statLabel: { color: "#94a3b8", fontSize: 11, fontWeight: "800" },
  statValue: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 6 },
  metaText: { color: "#94a3b8", marginTop: 10 },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    gap: 12,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#1b2538",
  },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#253147",
    backgroundColor: "#111827",
  },
  sortPillActive: { backgroundColor: "#e2e8f0", borderColor: "#e2e8f0" },
  sortPillText: { color: "#cbd5e1", fontSize: 11, fontWeight: "800" },
  sortPillTextActive: { color: "#111827" },
  sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "900", marginTop: 18, marginBottom: 12 },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1b2538",
    backgroundColor: "#111827",
    padding: 16,
  },
  emptyText: { color: "#94a3b8" },
  postCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1b2538",
    backgroundColor: "#111827",
    padding: 14,
  },
  postBody: { flexDirection: "row", gap: 12 },
  postTitle: { color: "#f8fafc", fontSize: 15, fontWeight: "900" },
  postMeta: { color: "#94a3b8", fontSize: 12, marginTop: 5 },
  postDetail: { color: "#d1d5db", fontSize: 13, lineHeight: 18, marginTop: 8 },
  postLink: { color: "#93c5fd", fontSize: 11, fontWeight: "800", marginTop: 10 },
  postThumb: { width: 78, height: 78, borderRadius: 12, backgroundColor: "#0f172a" },
});