import React, { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
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
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import dayjs from "dayjs";
import _ from "lodash";

import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { launchImageLibrary, Asset } from "react-native-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import type { RootStackParamList } from "../navigation/types";
import { ENV } from "../config/env";
import { useI18n } from "../i18n";
import {
  POST_FORM_BANKS,
  POST_FORM_PROVINCES,
  type PostFormBankItem,
  type PostFormProvinceItem,
} from "../constants/postFormOptions";

// ====================== GraphQL ======================

const Q_POST = gql`
  query ($id: ID!) {
    post(id: $id) {
      id
      title
      status
      auto_publish
      first_last_name
      id_card
      transfer_amount
      transfer_date
      website
      province_id
      province_name
      detail
      tel_numbers { id tel }
      seller_accounts { id bank_id bank_name seller_account }
      images { id url }
    }
  }
`;

const UPSERT = gql`
  mutation Upsert($id: ID, $data: PostInput!, $images: [Upload!], $image_ids_delete: [ID!]) {
    upsertPost(id: $id, data: $data, images: $images, image_ids_delete: $image_ids_delete) {
      id
      title
      auto_publish
      images { id url }
    }
  }
`;

// ====================== Types ======================

export type ExistingImage = { id: number | string; url: string };

export type PostRecord = {
  id?: number | string;
  title: string;
  status: "public" | "unpublic";
  images?: ExistingImage[];
  auto_publish?: boolean;

  first_last_name?: string;
  id_card?: string;
  transfer_amount?: number;
  transfer_date?: string;
  website?: string;
  province_id?: string;
  detail?: string;

  tel_numbers?: Array<{ id?: string | number; tel: string }>;
  seller_accounts?: Array<{ id?: string | number; bank_id: string; bank_name: string; seller_account?: string }>;
};

type PostQueryData = { post?: any | null };
type UpsertMutationData = {
  upsertPost?: {
    id?: string | number;
    auto_publish?: boolean;
    images?: Array<{ id: string | number; url: string }>;
  } | null;
};

enum Mode {
  New = "new",
  Edited = "edited",
  Deleted = "deleted",
  Unchanged = "unchanged",
}

type ITelNumber = { id: string; tel: string; mode: Mode };
type ISellerAccount = {
  id: string;
  bank_id: string;
  bank_name: string;
  seller_account: string;
  mode: Mode;
};

type ExistingFile = { _id: string | number; url: string; delete?: boolean };
type FileValue = ExistingFile | Asset;

type ProvinceItem = PostFormProvinceItem;
type BankItem = PostFormBankItem;

// ====================== dropdown data ======================
// Keep aligned with the web implementation.
const provinces: ProvinceItem[] = POST_FORM_PROVINCES;
const banks: BankItem[] = POST_FORM_BANKS;

// ====================== helpers ======================

const makeLocalId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toUploadFromAsset(a: Asset) {
  if (!a?.uri) return null;
  return {
    uri: a.uri,
    name: a.fileName || `image-${Date.now()}.jpg`,
    type: a.type || "image/jpeg",
  } as any;
}

function normalizeDateFromApi(v?: string | null): Date | null {
  if (!v) return null;
  // รองรับ timestamp string
  if (!isNaN(Number(v))) {
    const d = new Date(Number(v));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeImageUrl(url: string): string {
  // ถ้า backend ส่งเป็น full url อยู่แล้ว
  if (/^https?:\/\//i.test(url)) return url;
  // ถ้าเป็น /uploads/xxx
  return `${ENV.apiBase}${url}`;
}

// ====================== Navigation props ======================
// ✅ ต้องมีใน RootStackParamList:
// PostForm: { id?: string }
type Props = NativeStackScreenProps<RootStackParamList, "PostForm">;

export default function PostFormScreen({ route, navigation }: Props) {
  const { t } = useI18n();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const id = route.params?.id ? String(route.params.id) : undefined;
  const isEdit = !!id;

  // ===== initial load state (สำคัญสำหรับ edit) =====
  const [initialLoading, setInitialLoading] = useState<boolean>(!!isEdit);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<PostRecord | null>(null);

  // ===== form states =====
  const [first_last_name, setFirstLastName] = useState("");
  const [id_card, setIdCard] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [transfer_amount, setTransferAmount] = useState<string>("");
  const [transfer_date, setTransferDate] = useState<Date | null>(null);
  const [website, setWebsite] = useState("");
  const [province_id, setProvinceId] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState<"public" | "unpublic">("public");
  const [auto_publish, setAutoPublish] = useState(true);

  const [telNumbers, setTelNumbers] = useState<ITelNumber[]>([]);
  const [sellerAccounts, setSellerAccounts] = useState<ISellerAccount[]>([]);
  const [files, setFiles] = useState<FileValue[]>([]);

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ===== refs for scrolling to errors =====
  const scrollViewRef = useRef<ScrollView>(null);
  const fieldPositions = useRef<Record<string, number>>({});
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  // ===== snapshot for dirty check =====
  const initialSnapshotRef = useRef<any>(null);

  // ====================== normalize + dirty check ======================

  const normalizeComparable = useCallback(() => {
    const existing = files.filter((x: any) => x && "url" in x) as ExistingFile[];
    const keepExistingIds = existing
      .filter((x) => !x.delete)
      .map((x) => String(x._id))
      .sort();

    const deleteExistingIds = existing
      .filter((x) => !!x.delete)
      .map((x) => String(x._id))
      .sort();

    const newFilesCount = files.filter((x: any) => x && "uri" in x && !("url" in x)).length;

    return {
      form: {
        first_last_name: first_last_name.trim(),
        id_card: id_card.trim(),
        title: postTitle.trim(),
        transfer_amount: Number(transfer_amount || 0),
        transfer_date: transfer_date ? transfer_date.toISOString() : null,
        website: website.trim(),
        province_id: province_id ?? null,
        detail: detail ?? "",
        status,
        auto_publish: !!auto_publish,
      },
      tel_numbers: (telNumbers || [])
        .filter((t) => t.mode !== Mode.Deleted)
        .map((t) => ({ tel: t.tel.trim() }))
        .sort((a, b) => a.tel.localeCompare(b.tel)),
      seller_accounts: (sellerAccounts || [])
        .filter((s) => s.mode !== Mode.Deleted)
        .map((s) => ({
          bank_id: String(s.bank_id || ""),
          bank_name: (s.bank_name || "").trim(),
          seller_account: (s.seller_account || "").trim(),
        }))
        .sort((a, b) => (a.bank_name + a.seller_account).localeCompare(b.bank_name + b.seller_account)),
      files: { keepExistingIds, deleteExistingIds, newFilesCount },
    };
  }, [
    files,
    telNumbers,
    sellerAccounts,
    first_last_name,
    id_card,
    postTitle,
    transfer_amount,
    transfer_date,
    website,
    province_id,
    detail,
    status,
    auto_publish,
  ]);

  const recomputeDirty = useCallback(() => {
    const snap = initialSnapshotRef.current;
    if (!snap) {
      setDirty(true);
      return;
    }
    const current = normalizeComparable();

    const filesChanged =
      current.files.newFilesCount > 0 ||
      !_.isEqual(snap.files.keepExistingIds, current.files.keepExistingIds) ||
      !_.isEqual(snap.files.deleteExistingIds, current.files.deleteExistingIds);

    const formChanged = !_.isEqual(snap.form, current.form);
    const telChanged = !_.isEqual(snap.tel_numbers, current.tel_numbers);
    const sellerChanged = !_.isEqual(snap.seller_accounts, current.seller_accounts);

    setDirty(filesChanged || formChanged || telChanged || sellerChanged);
  }, [normalizeComparable]);

  // ====================== fetch initialData (edit) ======================

  const fetchInitial = useCallback(async () => {
    if (!id) return;
    setInitialLoading(true);
    setInitialError(null);

    try {
      const { data } = await client.query<PostQueryData>({
        query: Q_POST,
        variables: { id },
        fetchPolicy: "network-only",
      });

      const p = data?.post;
      if (!p?.id) throw new Error(t("postForm.errors.post_not_found"));

      const mapped: PostRecord = {
        id: p.id,
        title: p.title ?? "",
        status: p.status ?? "public",
        auto_publish: !!p.auto_publish,
        first_last_name: p.first_last_name ?? "",
        id_card: p.id_card ?? "",
        transfer_amount: typeof p.transfer_amount === "number" ? p.transfer_amount : Number(p.transfer_amount || 0),
        transfer_date: p.transfer_date ?? null,
        website: p.website ?? "",
        province_id: p.province_id ?? undefined,
        detail: p.detail ?? "",
        tel_numbers: (p.tel_numbers ?? []).map((t: any) => ({ id: t.id, tel: t.tel })),
        seller_accounts: (p.seller_accounts ?? []).map((s: any) => ({
          id: s.id,
          bank_id: s.bank_id,
          bank_name: s.bank_name,
          seller_account: s.seller_account ?? "",
        })),
        images: (p.images ?? []).map((img: any) => ({ id: img.id, url: normalizeImageUrl(img.url) })),
      };

      setInitialData(mapped);
    } catch (e: any) {
      setInitialError(e?.message || t("postForm.errors.load_edit_failed"));
    } finally {
      setInitialLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (isEdit) fetchInitial();
  }, [isEdit, fetchInitial]);

  // ====================== init states from initialData ======================

  useEffect(() => {
    // create mode: set defaults + snapshot
    if (!isEdit) {
      setFirstLastName("");
      setIdCard("");
      setPostTitle("");
      setTransferAmount("");
      setTransferDate(null);
      setWebsite("");
      setProvinceId(undefined);
      setDetail("");
      setStatus("public");
      setAutoPublish(true);

      setTelNumbers([]);
      setSellerAccounts([]);
      setFiles([]);

      // snapshot หลัง state set
      setTimeout(() => {
        initialSnapshotRef.current = normalizeComparable();
        setDirty(false);
      }, 0);
      return;
    }

    // edit mode: รอ initialData
    if (!initialData) return;

    setFirstLastName(initialData.first_last_name ?? "");
    setIdCard(initialData.id_card ?? "");
    setPostTitle(initialData.title ?? "");

    setTransferAmount(
      typeof initialData.transfer_amount === "number" ? String(initialData.transfer_amount) : ""
    );

    setTransferDate(normalizeDateFromApi(initialData.transfer_date));

    setWebsite(initialData.website ?? "");
    setProvinceId(initialData.province_id ?? undefined);
    setDetail(initialData.detail ?? "");
    setStatus(initialData.status ?? "public");
    setAutoPublish(typeof initialData.auto_publish === "boolean" ? initialData.auto_publish : true);

    const telInit: ITelNumber[] = (initialData.tel_numbers ?? []).map((t, idx) => ({
      id: typeof t.id !== "undefined" ? String(t.id) : makeLocalId(`tel-${idx}`),
      tel: t.tel,
      mode: Mode.Unchanged,
    }));
    setTelNumbers(telInit);

    const sellerInit: ISellerAccount[] = (initialData.seller_accounts ?? []).map((s, idx) => ({
      id: typeof s.id !== "undefined" ? String(s.id) : makeLocalId(`seller-${idx}`),
      bank_id: s.bank_id,
      bank_name: s.bank_name,
      seller_account: s.seller_account ?? "",
      mode: Mode.Unchanged,
    }));
    setSellerAccounts(sellerInit);

    const ex: ExistingFile[] = (initialData.images || []).map((img) => ({
      _id: img.id,
      url: img.url, // ✅ ตอน fetch เรา normalize แล้ว
    }));
    setFiles(ex);

    // snapshot หลัง state set
    setTimeout(() => {
      initialSnapshotRef.current = normalizeComparable();
      setDirty(false);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, initialData?.id]);

  // recompute dirty when anything changes
  useEffect(() => {
    if (!initialSnapshotRef.current) return;
    recomputeDirty();
  }, [recomputeDirty]);

  // ====================== actions ======================

  const addTelNumber = () => {
    setTelNumbers((prev) => [...prev, { id: makeLocalId("tel"), tel: "", mode: Mode.New }]);
  };

  const removeTelNumber = (index: number) => {
    setTelNumbers((prev) => prev.map((x, i) => (i === index ? { ...x, mode: Mode.Deleted } : x)));
  };

  const updateTel = (index: number, value: string) => {
    setTelNumbers((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      const mode = cur.mode === Mode.Unchanged ? Mode.Edited : cur.mode;
      next[index] = { ...cur, tel: value, mode };
      return next;
    });
  };

  const addSellerAccount = () => {
    setSellerAccounts((prev) => [
      ...prev,
      { id: makeLocalId("seller"), bank_id: "", bank_name: "", seller_account: "", mode: Mode.New },
    ]);
  };

  const removeSellerAccount = (index: number) => {
    setSellerAccounts((prev) => prev.map((x, i) => (i === index ? { ...x, mode: Mode.Deleted } : x)));
  };

  const updateSeller = (index: number, patch: Partial<ISellerAccount>) => {
    setSellerAccounts((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      const mode = cur.mode === Mode.Unchanged ? Mode.Edited : cur.mode;
      next[index] = { ...cur, ...patch, mode };
      return next;
    });
  };

  const pickImages = async () => {
    const res = await launchImageLibrary({
      mediaType: "photo",
      selectionLimit: 0,
    });

    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert(t("postForm.alerts.pick_image_failed_title"), res.errorMessage || res.errorCode);
      return;
    }

    const assets = (res.assets || []).filter((a) => !!a.uri);
    if (!assets.length) return;

    setFiles((prev) => [...prev, ...assets]);
  };

  const toggleDeleteExistingImage = (id: string | number) => {
    setFiles((prev) =>
      prev.map((f: any) => {
        if (f && "url" in f && String(f._id) === String(id)) {
          return { ...f, delete: !f.delete };
        }
        return f;
      })
    );
  };

  const removeNewPickedImage = (uri: string) => {
    setFiles((prev) => prev.filter((f: any) => !(f && "uri" in f && f.uri === uri)));
  };

  // ====================== submit ======================

  const validateForm = useCallback((): Record<string, string> => {
    const newErrors: Record<string, string> = {};

    if (!first_last_name.trim()) {
      newErrors.seller_name = t("postForm.validation_inline.seller_name_required");
    }
    if (!postTitle.trim()) {
      newErrors.product = t("postForm.validation_inline.product_required");
    }
    if (!transfer_amount || Number(transfer_amount) <= 0) {
      if (!transfer_amount) {
        newErrors.transfer_amount = t("postForm.validation_inline.transfer_amount_required");
      } else {
        newErrors.transfer_amount = t("postForm.validation_inline.transfer_amount_invalid");
      }
    }
    if (!transfer_date) {
      newErrors.transfer_date = t("postForm.validation_inline.transfer_date_required");
    }
    if (!province_id) {
      newErrors.province = t("postForm.validation_inline.province_required");
    } else if (!isUuid(province_id)) {
      newErrors.province = t("postForm.validation_inline.province_required");
    }

    return newErrors;
  }, [first_last_name, postTitle, transfer_amount, transfer_date, province_id, t]);

  const scrollToFirstError = useCallback((validationErrors: Record<string, string>) => {
    const fieldOrder = [
      'seller_name',
      'product',
      'transfer_amount',
      'transfer_date',
      'province',
    ];

    const firstErrorField = fieldOrder.find((field) => validationErrors[field]);
    if (!firstErrorField) return;

    const fieldY = fieldPositions.current[firstErrorField];
    const inputRef = inputRefs.current[firstErrorField];

    if (fieldY !== undefined) {
      // Scroll to field position with 20px top padding for visibility
      const targetY = Math.max(0, fieldY - 20);
      scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
      
      // Try to focus the input after scroll
      setTimeout(() => {
        if (inputRef && firstErrorField !== 'transfer_date' && firstErrorField !== 'province') {
          inputRef.focus();
        }
      }, 300);
    }
  }, []);

  const onSubmit = useCallback(async () => {
    if (saving) return;

    // Clear previous errors
    setErrors({});

    // Validate form
    const validationErrors = validateForm();
    
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      scrollToFirstError(validationErrors);
      return;
    }

    try {
      setSaving(true);

      const existingDeleteIds = (files.filter((f: any) => f && "url" in f && f.delete) as ExistingFile[]).map((f) =>
        String(f._id)
      );

      const newAssets = files.filter((f: any) => f && "uri" in f && !("url" in f)) as Asset[];
      const uploadFiles = newAssets.map(toUploadFromAsset).filter(Boolean);

      const tel_numbers_payload = telNumbers
        .filter((t) => t.mode !== Mode.Unchanged)
        .map((t) => ({ id: t.id, tel: t.tel, mode: t.mode }));

      const seller_accounts_payload = sellerAccounts
        .filter((s) => s.mode !== Mode.Unchanged)
        .map((s) => ({
          id: s.id,
          bank_id: s.bank_id,
          bank_name: s.bank_name,
          seller_account: s.seller_account,
          mode: s.mode,
        }));

      const variables: any = {
        id: isEdit ? String(id) : null,
        data: {
          first_last_name: first_last_name.trim(),
          id_card: id_card.trim(),
          title: postTitle.trim(),
          transfer_amount: Number(transfer_amount || 0),
          transfer_date: transfer_date!.toISOString(),
          website: website.trim(),
          province_id,
          detail,
          tel_numbers: tel_numbers_payload,
          seller_accounts: seller_accounts_payload,
          status,
          auto_publish: !!auto_publish,
        },
        image_ids_delete: existingDeleteIds,
      };

      if (__DEV__) {
        console.log("[PostForm] UPSERT variables =", {
          id: variables?.id,
          province_id: variables?.data?.province_id,
          hasImages: Array.isArray(variables?.images) ? variables.images.length : 0,
          image_ids_delete: variables?.image_ids_delete,
        });
      }

      if (uploadFiles.length > 0) variables.images = uploadFiles;

      const { data } = await client.mutate<UpsertMutationData>({ mutation: UPSERT, variables });
      const saved = data?.upsertPost;

      if (!saved?.id) {
        Alert.alert(
          t("postForm.alerts.not_success_title"),
          isEdit ? t("postForm.alerts.save_failed") : t("postForm.alerts.create_failed")
        );
        return;
      }

      Alert.alert(
        t("common.success"),
        saved.auto_publish
          ? isEdit
            ? t("postForm.alerts.saved_auto")
            : t("postForm.alerts.created_auto")
          : isEdit
            ? t("postForm.alerts.saved")
            : t("postForm.alerts.created")
      );

      const savedImgs: ExistingFile[] = (saved.images || []).map((img: any) => ({
        _id: img.id,
        url: normalizeImageUrl(img.url),
      }));
      setFiles(savedImgs);

      const nextTel = telNumbers.filter((t) => t.mode !== Mode.Deleted).map((t) => ({ ...t, mode: Mode.Unchanged }));
      const nextSeller = sellerAccounts
        .filter((s) => s.mode !== Mode.Deleted)
        .map((s) => ({ ...s, mode: Mode.Unchanged }));

      setTelNumbers(nextTel);
      setSellerAccounts(nextSeller);

      setTimeout(() => {
        initialSnapshotRef.current = normalizeComparable();
        setDirty(false);
      }, 0);

      // ✅ หลัง save:
      // - ถ้า create ใหม่ → replace ไปเป็น edit ของ id ใหม่ได้เลย
      if (!isEdit) {
        navigation.replace("PostForm", { id: String(saved.id) });
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || t("postForm.alerts.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    validateForm,
    scrollToFirstError,
    files,
    telNumbers,
    sellerAccounts,
    isEdit,
    id,
    first_last_name,
    id_card,
    postTitle,
    transfer_amount,
    transfer_date,
    website,
    province_id,
    detail,
    status,
    auto_publish,
    navigation,
    normalizeComparable,
    t,
  ]);

  // ====================== header config ======================

  const headerTitle = isEdit ? t("postForm.title_edit") : t("postForm.title_create");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: headerTitle,
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerTitleStyle: { color: "#fff", fontWeight: "800" },
    });
  }, [navigation, headerTitle]);

  // ✅ เตือนก่อนออก ถ้า dirty
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (!dirty || saving) return;
      e.preventDefault();

      Alert.alert(t("postForm.before_leave.title"), t("postForm.before_leave.message"), [
        { text: t("postForm.before_leave.stay"), style: "cancel" },
        { text: t("postForm.before_leave.leave"), style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });

    return unsub;
  }, [navigation, dirty, saving, t]);

  // ====================== UI ======================

  const showTransferDateLabel = useMemo(() => {
    if (!transfer_date) return t("postForm.fields.transfer_date_placeholder");
    return dayjs(transfer_date).format("DD/MM/YYYY");
  }, [transfer_date, t]);

  const [showDatePicker, setShowDatePicker] = useState(false);

  // ===== edit loading/error =====
  if (initialLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={[styles.hint, { marginTop: 10 }]}>{t("postForm.loading_edit")}</Text>
      </View>
    );
  }

  if (initialError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{initialError}</Text>
        <Pressable style={[styles.outlineBtn, { marginTop: 12, width: 160 }]} onPress={fetchInitial}>
          <Text style={styles.outlineText}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView 
        ref={scrollViewRef}
        style={styles.screen} 
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
      <SectionHeader 
        title={t("postForm.sections.seller_info")} 
        subtitle={t("postForm.sections.seller_info_desc")} 
      />

      <View style={isTablet ? styles.rowTablet : undefined}>
        <Field 
          label={t("postForm.fields.seller_name")} 
          style={isTablet && styles.halfField}
          error={errors.seller_name}
          onLayout={(e) => {
            fieldPositions.current.seller_name = e.nativeEvent.layout.y;
          }}
        >
          <TextInput
            ref={(ref) => { inputRefs.current.seller_name = ref; }}
            value={first_last_name}
            onChangeText={(v) => {
              setFirstLastName(v);
              if (errors.seller_name) setErrors((prev) => ({ ...prev, seller_name: '' }));
            }}
            placeholder={t("postForm.fields.seller_name_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.input, errors.seller_name && styles.inputError]}
          />
        </Field>

        <Field label={t("postForm.fields.id_card")} style={isTablet && styles.halfField}>
          <TextInput
            value={id_card}
            onChangeText={setIdCard}
            placeholder={t("postForm.fields.id_card_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
            maxLength={13}
            keyboardType="number-pad"
          />
        </Field>
      </View>

      <SectionHeader 
        title={t("postForm.sections.transaction_info")} 
        subtitle={t("postForm.sections.transaction_info_desc")} 
      />

      <View style={isTablet ? styles.rowTablet : undefined}>
        <Field 
          label={t("postForm.fields.product")} 
          style={isTablet && styles.halfField}
          error={errors.product}
          onLayout={(e) => {
            fieldPositions.current.product = e.nativeEvent.layout.y;
          }}
        >
          <TextInput
            ref={(ref) => { inputRefs.current.product = ref; }}
            value={postTitle}
            onChangeText={(v) => {
              setPostTitle(v);
              if (errors.product) setErrors((prev) => ({ ...prev, product: '' }));
            }}
            placeholder={t("postForm.fields.product_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.input, errors.product && styles.inputError]}
          />
        </Field>

        <Field 
          label={t("postForm.fields.transfer_amount")} 
          style={isTablet && styles.halfField}
          error={errors.transfer_amount}
          onLayout={(e) => {
            fieldPositions.current.transfer_amount = e.nativeEvent.layout.y;
          }}
        >
          <TextInput
            ref={(ref) => { inputRefs.current.transfer_amount = ref; }}
            value={transfer_amount}
            onChangeText={(v) => {
              setTransferAmount(v);
              if (errors.transfer_amount) setErrors((prev) => ({ ...prev, transfer_amount: '' }));
            }}
            placeholder={t("postForm.fields.transfer_amount_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.input, errors.transfer_amount && styles.inputError]}
            keyboardType="numeric"
          />
        </Field>
      </View>

      <View style={isTablet ? styles.rowTablet : undefined}>
        <Field 
          label={t("postForm.fields.transfer_date")} 
          style={isTablet && styles.halfField}
          error={errors.transfer_date}
          onLayout={(e) => {
            fieldPositions.current.transfer_date = e.nativeEvent.layout.y;
          }}
        >
          <Pressable 
            style={[styles.dateBtn, errors.transfer_date && styles.inputError]} 
            onPress={() => {
              setShowDatePicker(true);
              if (errors.transfer_date) setErrors((prev) => ({ ...prev, transfer_date: '' }));
            }}
          >
            <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.65)" style={{ marginRight: 8 }} />
            <Text style={styles.dateText}>{showTransferDateLabel}</Text>
          </Pressable>

          {showDatePicker && (
            <DateTimePicker
              value={transfer_date ?? new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event, date) => {
                if (Platform.OS !== "ios") setShowDatePicker(false);
                if (date) {
                  setTransferDate(date);
                  if (errors.transfer_date) setErrors((prev) => ({ ...prev, transfer_date: '' }));
                }
              }}
            />
          )}

          {Platform.OS === "ios" && showDatePicker && (
            <Pressable style={styles.smallBtn} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.smallBtnText}>{t("postForm.done")}</Text>
            </Pressable>
          )}
        </Field>

        <Field label={t("postForm.fields.website")} style={isTablet && styles.halfField}>
          <TextInput
            value={website}
            onChangeText={setWebsite}
            placeholder={t("postForm.fields.website_placeholder")}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
          />
        </Field>
      </View>

      <SectionHeader 
        title={t("postForm.sections.additional_details")} 
        subtitle={t("postForm.sections.additional_details_desc")} 
      />

      <Field label={t("postForm.fields.detail")}>
        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder={t("postForm.fields.detail_placeholder")}
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={[styles.input, styles.textarea]}
          multiline
        />
      </Field>

      <SectionHeader 
        title={t("postForm.sections.contact_channels")} 
        subtitle={t("postForm.sections.contact_channels_desc")} 
      />

      <View style={styles.sectionBox}>
        {telNumbers.map((telItem, index) =>
          telItem.mode === Mode.Deleted ? null : (
            <View key={telItem.id} style={styles.box}>
              <Text style={styles.boxTitle}>{t("postForm.contact_item", { index: index + 1 })}</Text>
              <TextInput
                value={telItem.tel}
                onChangeText={(v) => updateTel(index, v)}
                placeholder={t("postForm.fields.contact_placeholder")}
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
              />
              <Pressable 
                style={styles.iconDeleteBtn} 
                onPress={() => removeTelNumber(index)}
              >
                <Ionicons name="close-circle" size={20} color="#ff6b6b" />
                <Text style={styles.dangerText}>{t("common.delete")}</Text>
              </Pressable>
            </View>
          )
        )}

        <Pressable style={styles.outlineBtn} onPress={addTelNumber}>
          <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.outlineText}>{t("postForm.actions.add_contact")}</Text>
        </Pressable>
      </View>

      <SectionHeader 
        title={t("postForm.sections.seller_accounts")} 
        subtitle={t("postForm.sections.seller_accounts_desc")} 
      />

      <View style={styles.sectionBox}>
        {sellerAccounts.map((s, index) =>
          s.mode === Mode.Deleted ? null : (
            <View key={s.id} style={styles.box}>
              <Text style={styles.boxTitle}>{t("postForm.seller_item", { index: index + 1 })}</Text>

              <Field label={t("postForm.fields.seller_account_name")}>
                <TextInput
                  value={s.bank_name}
                  onChangeText={(v) => updateSeller(index, { bank_name: v })}
                  placeholder={t("postForm.fields.seller_account_name_placeholder")}
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.input}
                />
              </Field>

              <Field label={t("postForm.fields.seller_account_number")}>
                <TextInput
                  value={s.seller_account}
                  onChangeText={(v) => updateSeller(index, { seller_account: v })}
                  placeholder={t("postForm.fields.seller_account_number_placeholder")}
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.input}
                  keyboardType="number-pad"
                />
              </Field>

              <Field label={t("postForm.fields.select_bank")}>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={s.bank_id}
                    onValueChange={(v) => updateSeller(index, { bank_id: String(v) })}
                    dropdownIconColor="#fff"
                    style={styles.picker}
                  >
                    <Picker.Item label={t("postForm.fields.select_bank_placeholder")} value="" />
                    {banks.map((b) => (
                      <Picker.Item key={b.id} label={b.name_th} value={b.id} />
                    ))}
                  </Picker>
                </View>
              </Field>

              <Pressable 
                style={styles.iconDeleteBtn} 
                onPress={() => removeSellerAccount(index)}
              >
                <Ionicons name="close-circle" size={20} color="#ff6b6b" />
                <Text style={styles.dangerText}>{t("common.delete")}</Text>
              </Pressable>
            </View>
          )
        )}

        <Pressable style={styles.outlineBtn} onPress={addSellerAccount}>
          <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.outlineText}>{t("postForm.actions.add_seller_account")}</Text>
        </Pressable>
      </View>

      <SectionHeader 
        title={t("postForm.sections.attachments")} 
        subtitle={t("postForm.sections.attachments_desc")} 
      />

      <View style={styles.sectionBox}>
        <Pressable style={styles.outlineBtn} onPress={pickImages}>
          <Ionicons name="images-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.outlineText}>{t("postForm.actions.pick_images")}</Text>
        </Pressable>

        <View style={styles.imagesRow}>
          {files.map((f: any) => {
            if (f && "url" in f) {
              const deleted = !!f.delete;
              return (
                <Pressable
                  key={`ex-${String(f._id)}`}
                  style={[styles.thumbWrap, deleted && { opacity: 0.35 }]}
                  onPress={() => toggleDeleteExistingImage(f._id)}
                >
                  <Image source={{ uri: f.url }} style={styles.thumb} />
                  <Text style={styles.thumbLabel}>{deleted ? t("postForm.image.will_delete") : t("postForm.image.tap_to_delete")}</Text>
                </Pressable>
              );
            }

            if (f && "uri" in f) {
              return (
                <Pressable
                  key={`new-${f.uri}`}
                  style={styles.thumbWrap}
                  onPress={() => removeNewPickedImage(f.uri)}
                >
                  <Image source={{ uri: f.uri }} style={styles.thumb} />
                  <Text style={styles.thumbLabel}>{t("postForm.image.tap_to_delete")}</Text>
                </Pressable>
              );
            }

            return null;
          })}
        </View>
      </View>

      <SectionHeader 
        title={t("postForm.sections.publish_settings")} 
        subtitle={t("postForm.sections.publish_settings_desc")} 
      />

      <Field 
        label={t("postForm.fields.province")}
        error={errors.province}
        onLayout={(e) => {
          fieldPositions.current.province = e.nativeEvent.layout.y;
        }}
      >
        <View style={[styles.pickerWrap, errors.province && styles.inputError]}>
          <Picker
            selectedValue={province_id || ""}
            onValueChange={(v) => {
              setProvinceId(String(v) || undefined);
              if (errors.province) setErrors((prev) => ({ ...prev, province: '' }));
            }}
            dropdownIconColor="#fff"
            style={styles.picker}
          >
            <Picker.Item label={t("postForm.fields.province_placeholder")} value="" />
            {provinces.map((p) => (
              <Picker.Item key={p.id} label={p.name_th} value={p.id} />
            ))}
          </Picker>
        </View>
      </Field>

      <View style={styles.autoBox}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.autoTitle}>{t("postForm.fields.auto_publish")}</Text>
          <Switch value={auto_publish} onValueChange={setAutoPublish} />
        </View>
        <Text style={styles.autoDesc}>
          {t("postForm.fields.auto_publish_desc")}
        </Text>
      </View>

      <Field label={t("postForm.fields.status")}>
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={status}
            onValueChange={(v) => setStatus(v as "public" | "unpublic")}
            dropdownIconColor="#fff"
            style={styles.picker}
          >
            <Picker.Item label={t("postForm.fields.status_public")} value="public" />
            <Picker.Item label={t("postForm.fields.status_unpublic")} value="unpublic" />
          </Picker>
        </View>
      </Field>

      {!dirty && <Text style={styles.hint}>{t("postForm.hint.no_changes")}</Text>}
      {dirty && <Text style={styles.hint}>{t("postForm.hint.has_changes")}</Text>}

      <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky submit button */}
      <View style={styles.stickyBottom}>
        <Pressable
          onPress={onSubmit}
          disabled={saving}
          style={({ pressed }) => [
            styles.submitBtn,
            (saving || pressed) && { opacity: saving ? 0.6 : 0.7 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.submitBtnText}>{t("common.save")}</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ====================== UI helpers ======================

function Field({ 
  label, 
  children, 
  style, 
  error, 
  onLayout 
}: { 
  label: string; 
  children: React.ReactNode; 
  style?: any; 
  error?: string;
  onLayout?: (event: any) => void;
}) {
  return (
    <View 
      onLayout={onLayout}
      style={[{ marginBottom: 18 }, style]}
    >
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}



// ====================== styles ======================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0b" },
  container: { padding: 16, paddingBottom: 40 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0b0b0b", padding: 16 },
  errorText: { color: "#ff6b6b", fontWeight: "900", textAlign: "center" },

  h1: { color: "white", fontSize: 18, fontWeight: "900", marginBottom: 12 },

  label: { color: "rgba(255,255,255,0.75)", marginBottom: 8, fontWeight: "700", fontSize: 14 },
  input: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "white",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    fontSize: 15,
  },
  inputError: {
    borderColor: "rgba(255,100,100,0.5)",
    borderWidth: 1.5,
  },
  fieldError: {
    color: "#ff6b6b",
    fontSize: 13,
    marginTop: 6,
    marginLeft: 2,
    fontWeight: "600",
  },
  textarea: { height: 110, paddingTop: 14, textAlignVertical: "top" },

  sectionHeader: {
    marginTop: 24,
    marginBottom: 16,
  },
  sectionTitle: { 
    color: "white", 
    fontSize: 17, 
    fontWeight: "900", 
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "500",
  },
  sectionBox: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#101010",
  },

  box: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#0f0f0f",
  },
  boxTitle: { color: "white", fontWeight: "800", marginBottom: 10 },

  outlineBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    flexDirection: "row",
  },
  outlineText: { color: "white", fontWeight: "800", fontSize: 15 },

  iconDeleteBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.35)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  dangerText: { color: "#ff6b6b", fontWeight: "800", fontSize: 14 },

  hint: { 
    marginTop: 16, 
    marginBottom: 8,
    color: "rgba(255,255,255,0.55)", 
    fontSize: 13,
    textAlign: "center",
  },

  pickerWrap: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#151515",
  },
  picker: { color: "white" },

  dateBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#151515",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  dateText: { color: "white", fontWeight: "700", fontSize: 15 },
  smallBtn: {
    marginTop: 8,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  smallBtnText: { color: "white", fontWeight: "800" },

  autoBox: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    backgroundColor: "#101010",
  },
  autoTitle: { color: "white", fontWeight: "900" },
  autoDesc: { color: "rgba(255,255,255,0.65)", marginTop: 6, lineHeight: 18 },

  imagesRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  thumbWrap: { width: 110 },
  thumb: { width: 110, height: 110, borderRadius: 12, backgroundColor: "#222" },
  thumbLabel: { color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 6 },

  headerBtn: {
    // paddingHorizontal: 12,
    // paddingVertical: 8,
    // borderRadius: 12,
    // borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    // backgroundColor: "rgba(255,255,255,0.06)",
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { color: "#fff", fontWeight: "900" },

  // Responsive tablet layout
  rowTablet: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  halfField: {
    flex: 1,
  },

  // Sticky submit button
  stickyBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#0b0b0b",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  submitBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: "#34c759",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
