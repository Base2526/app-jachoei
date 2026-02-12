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
} from "react-native";
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

type ProvinceItem = { id: string; name_th: string };
type BankItem = { id: string; name_th: string; type: "bank" | "ewallet" };

// ====================== dropdown data (ตัวอย่าง) ======================
// ✅ ใส่ของจริงของคุณแทนได้
const provinces: ProvinceItem[] = [
  { id: "1a6c...00001", name_th: "กรุงเทพมหานคร" },
  { id: "1a6c...00009", name_th: "ชลบุรี" },
  { id: "1a6c...00014", name_th: "เชียงใหม่" },
  { id: "1a6c...00042", name_th: "ภูเก็ต" },
];

const banks: BankItem[] = [
  { id: "bbl", name_th: "ธนาคารกรุงเทพ", type: "bank" },
  { id: "kbank", name_th: "ธนาคารกสิกรไทย", type: "bank" },
  { id: "scb", name_th: "ธนาคารไทยพาณิชย์", type: "bank" },
  { id: "truemoney", name_th: "ทรูมันนี่ วอลเล็ท", type: "ewallet" },
  { id: "linepay", name_th: "ไลน์เพย์", type: "ewallet" },
];

// ====================== helpers ======================

const makeLocalId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      const { data } = await client.query({
        query: Q_POST,
        variables: { id },
        fetchPolicy: "network-only",
      });

      const p = data?.post;
      if (!p?.id) throw new Error("ไม่พบโพสต์");

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
      setInitialError(e?.message || "โหลดข้อมูลสำหรับแก้ไขไม่สำเร็จ");
    } finally {
      setInitialLoading(false);
    }
  }, [id]);

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
      quality: 0.85,
    });

    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert("Pick image failed", res.errorMessage || res.errorCode);
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

  const onSubmit = async () => {
    if (saving) return;

    if (!first_last_name.trim()) return Alert.alert("กรุณากรอก", "ชื่อ-นามสกุล คนขาย");
    if (!postTitle.trim()) return Alert.alert("กรุณากรอก", "สินค้า/บริการ ที่สั่งซื้อ");
    if (!transfer_amount || Number(transfer_amount) <= 0) return Alert.alert("กรุณากรอก", "ยอดโอน");
    if (!transfer_date) return Alert.alert("กรุณาเลือก", "วันโอนเงิน");
    if (!province_id) return Alert.alert("กรุณาเลือก", "จังหวัด");

    try {
      setSaving(true);

      const existingDeleteIds = (files.filter((f: any) => f && "url" in f && f.delete) as ExistingFile[])
        .map((f) => String(f._id));

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
          transfer_date: transfer_date.toISOString(),
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

      if (uploadFiles.length > 0) variables.images = uploadFiles;

      const { data } = await client.mutate({ mutation: UPSERT, variables });
      const saved = data?.upsertPost;

      if (!saved?.id) {
        Alert.alert("ไม่สำเร็จ", isEdit ? "บันทึกไม่สำเร็จ" : "สร้างรายการไม่สำเร็จ");
        return;
      }

      Alert.alert(
        "สำเร็จ",
        saved.auto_publish
          ? (isEdit ? "บันทึกสำเร็จ และระบบจะเผยแพร่อัตโนมัติ" : "สร้างรายการสำเร็จ และระบบจะเผยแพร่อัตโนมัติ")
          : (isEdit ? "บันทึกสำเร็จ" : "สร้างรายการสำเร็จ")
      );

      const savedImgs: ExistingFile[] = (saved.images || []).map((img: any) => ({
        _id: img.id,
        url: normalizeImageUrl(img.url),
      }));
      setFiles(savedImgs);

      const nextTel = telNumbers
        .filter((t) => t.mode !== Mode.Deleted)
        .map((t) => ({ ...t, mode: Mode.Unchanged }));
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
      Alert.alert("Error", e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ====================== header config + Save button ======================

  const headerTitle = isEdit ? "แก้ไขรายการ" : "สร้างรายการใหม่";
  const canSave = dirty && !saving && !initialLoading;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: headerTitle,
      headerStyle: { backgroundColor: "#0b0b0f" },
      headerTintColor: "#fff",
      headerTitleStyle: { color: "#fff", fontWeight: "800" },
      headerBackTitleVisible: false,

      headerRight: () => (
        <Pressable
          onPress={onSubmit}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.headerBtn,
            (!canSave || pressed) && { opacity: !canSave ? 0.35 : 0.7 },
          ]}
        >
          {saving ? <ActivityIndicator /> : <Text style={styles.headerBtnText}>Save</Text>}
        </Pressable>
      ),
    });
  }, [navigation, headerTitle, canSave, saving, dirty, initialLoading]);

  // ✅ เตือนก่อนออก ถ้า dirty
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (!dirty || saving) return;
      e.preventDefault();

      Alert.alert("ยังไม่ได้บันทึก", "คุณแก้ไขข้อมูลแล้ว ต้องการออกโดยไม่บันทึกไหม?", [
        { text: "อยู่ต่อ", style: "cancel" },
        { text: "ออกเลย", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });

    return unsub;
  }, [navigation, dirty, saving]);

  // ====================== UI ======================

  const showTransferDateLabel = useMemo(() => {
    if (!transfer_date) return "กรุณาเลือกวันโอนเงิน";
    return dayjs(transfer_date).format("DD/MM/YYYY");
  }, [transfer_date]);

  const [showDatePicker, setShowDatePicker] = useState(false);

  // ===== edit loading/error =====
  if (initialLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
        <Text style={[styles.hint, { marginTop: 10 }]}>กำลังโหลดข้อมูลเพื่อแก้ไข…</Text>
      </View>
    );
  }

  if (initialError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{initialError}</Text>
        <Pressable style={[styles.outlineBtn, { marginTop: 12, width: 160 }]} onPress={fetchInitial}>
          <Text style={styles.outlineText}>ลองใหม่</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Field label="ชื่อ-นามสกุล คนขาย">
        <TextInput
          value={first_last_name}
          onChangeText={setFirstLastName}
          placeholder="กรุณากรอกชื่อ-นามสกุล คนขาย"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
      </Field>

      <Field label="เลขบัตรประชาชนคนขาย (13 หลัก) หรือ พาสปอร์ต">
        <TextInput
          value={id_card}
          onChangeText={setIdCard}
          placeholder="กรุณากรอกเลขบัตรประชาชน หรือ พาสปอร์ต"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          maxLength={13}
          keyboardType="number-pad"
        />
      </Field>

      <Field label="สินค้า/บริการ ที่สั่งซื้อ">
        <TextInput
          value={postTitle}
          onChangeText={setPostTitle}
          placeholder="กรุณากรอกสินค้า/บริการ ที่สั่งซื้อ"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
      </Field>

      <Field label="ยอดโอน">
        <TextInput
          value={transfer_amount}
          onChangeText={setTransferAmount}
          placeholder="กรุณากรอกยอดโอน"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          keyboardType="numeric"
        />
      </Field>

      <Field label="วันโอนเงิน">
        <Pressable style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
          <Text style={styles.dateText}>{showTransferDateLabel}</Text>
        </Pressable>

        {showDatePicker && (
          <DateTimePicker
            value={transfer_date ?? new Date()}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(event, date) => {
              if (Platform.OS !== "ios") setShowDatePicker(false);
              if (date) setTransferDate(date);
            }}
          />
        )}

        {Platform.OS === "ios" && showDatePicker && (
          <Pressable style={styles.smallBtn} onPress={() => setShowDatePicker(false)}>
            <Text style={styles.smallBtnText}>เสร็จสิ้น</Text>
          </Pressable>
        )}
      </Field>

      <Field label="เว็บ/แพลตฟอร์มที่ประกาศขาย">
        <TextInput
          value={website}
          onChangeText={setWebsite}
          placeholder="เช่น Facebook Marketplace, Kaidee, Shopee"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
        />
      </Field>

      <Field label="รายละเอียดเพิ่มเติม">
        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder="กรุณากรอกรายละเอียดเพิ่มเติม"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={[styles.input, styles.textarea]}
          multiline
        />
      </Field>

      <Section title="เบอร์โทรศัพท์ / LINE / ช่องทางติดต่อ">
        {telNumbers.map((t, index) =>
          t.mode === Mode.Deleted ? null : (
            <View key={t.id} style={styles.box}>
              <Text style={styles.boxTitle}>ช่องทางติดต่อ {index + 1}</Text>
              <TextInput
                value={t.tel}
                onChangeText={(v) => updateTel(index, v)}
                placeholder="เช่น 08x-xxx-xxxx หรือ LINE ID"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
              />
              <Pressable style={styles.dangerBtn} onPress={() => removeTelNumber(index)}>
                <Text style={styles.dangerText}>ลบ</Text>
              </Pressable>
            </View>
          )
        )}

        <Pressable style={styles.outlineBtn} onPress={addTelNumber}>
          <Text style={styles.outlineText}>+ เพิ่มช่องทางติดต่อ</Text>
        </Pressable>
      </Section>

      <Section title="บัญชีคนขาย">
        {sellerAccounts.map((s, index) =>
          s.mode === Mode.Deleted ? null : (
            <View key={s.id} style={styles.box}>
              <Text style={styles.boxTitle}>บัญชีคนขาย {index + 1}</Text>

              <Field label="ชื่อบัญชีคนขาย">
                <TextInput
                  value={s.bank_name}
                  onChangeText={(v) => updateSeller(index, { bank_name: v })}
                  placeholder="ชื่อบัญชีตามหน้า Bank"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.input}
                />
              </Field>

              <Field label="เลขที่บัญชีคนขาย">
                <TextInput
                  value={s.seller_account}
                  onChangeText={(v) => updateSeller(index, { seller_account: v })}
                  placeholder="กรอกเลขบัญชี"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.input}
                  keyboardType="number-pad"
                />
              </Field>

              <Field label="เลือกธนาคาร">
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={s.bank_id}
                    onValueChange={(v) => updateSeller(index, { bank_id: String(v) })}
                    dropdownIconColor="#fff"
                    style={styles.picker}
                  >
                    <Picker.Item label="กรุณาเลือกธนาคาร" value="" />
                    {banks.map((b) => (
                      <Picker.Item key={b.id} label={b.name_th} value={b.id} />
                    ))}
                  </Picker>
                </View>
              </Field>

              <Pressable style={styles.dangerBtn} onPress={() => removeSellerAccount(index)}>
                <Text style={styles.dangerText}>ลบ</Text>
              </Pressable>
            </View>
          )
        )}

        <Pressable style={styles.outlineBtn} onPress={addSellerAccount}>
          <Text style={styles.outlineText}>+ เพิ่มบัญชีคนขายใหม่</Text>
        </Pressable>
      </Section>

      <Section title="ไฟล์แนบ (รูปภาพ)">
        <Pressable style={styles.outlineBtn} onPress={pickImages}>
          <Text style={styles.outlineText}>+ เลือกรูปภาพ</Text>
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
                  <Text style={styles.thumbLabel}>{deleted ? "จะลบ" : "แตะเพื่อลบ"}</Text>
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
                  <Text style={styles.thumbLabel}>แตะเพื่อลบ</Text>
                </Pressable>
              );
            }

            return null;
          })}
        </View>
      </Section>

      <Field label="จังหวัดของคนสร้างรายงาน">
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={province_id || ""}
            onValueChange={(v) => setProvinceId(String(v) || undefined)}
            dropdownIconColor="#fff"
            style={styles.picker}
          >
            <Picker.Item label="กรุณาเลือกจังหวัด" value="" />
            {provinces.map((p) => (
              <Picker.Item key={p.id} label={p.name_th} value={p.id} />
            ))}
          </Picker>
        </View>
      </Field>

      <View style={styles.autoBox}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={styles.autoTitle}>เผยแพร่อัตโนมัติ (Auto Publish)</Text>
          <Switch value={auto_publish} onValueChange={setAutoPublish} />
        </View>
        <Text style={styles.autoDesc}>
          เมื่อเปิด ระบบจะนำข้อมูลนี้ไปเผยแพร่ไปยังช่องทางที่ตั้งค่าไว้ (เช่น X / Facebook) แบบอัตโนมัติหลังบันทึก
        </Text>
      </View>

      <Field label="สถานะ">
        <View style={styles.pickerWrap}>
          <Picker
            selectedValue={status}
            onValueChange={(v) => setStatus(v)}
            dropdownIconColor="#fff"
            style={styles.picker}
          >
            <Picker.Item label="public" value="public" />
            <Picker.Item label="unpublic" value="unpublic" />
          </Picker>
        </View>
      </Field>

      {!dirty && <Text style={styles.hint}>ยังไม่มีการแก้ไขข้อมูล</Text>}
      {dirty && <Text style={styles.hint}>มีการแก้ไขแล้ว (กด Save ด้านขวาบน)</Text>}
    </ScrollView>
  );
}

// ====================== UI helpers ======================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 12, marginBottom: 6 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
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

  label: { color: "rgba(255,255,255,0.75)", marginBottom: 6, fontWeight: "700" },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "white",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  textarea: { height: 110, paddingTop: 12, textAlignVertical: "top" },

  sectionTitle: { color: "white", fontSize: 16, fontWeight: "900", marginBottom: 10 },
  sectionBody: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 12,
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
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  outlineText: { color: "white", fontWeight: "800" },

  dangerBtn: {
    marginTop: 10,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { color: "#ff6b6b", fontWeight: "800" },

  hint: { marginTop: 10, color: "rgba(255,255,255,0.55)" },

  pickerWrap: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#151515",
  },
  picker: { color: "white" },

  dateBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#151515",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  dateText: { color: "white", fontWeight: "800" },
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { color: "#fff", fontWeight: "900" },
});
