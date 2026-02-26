// src/components/BottomSheetReportBankModal.tsx
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

export type BankCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type BottomSheetReportBankModalOpenArgs = {
  bankName: string | null;
  account: string;            // normalized digits
  postId?: string;
  title?: string;
  source?: "HOME" | "MODAL";
};

export type BottomSheetReportBankModalRef = {
  open: (args: BottomSheetReportBankModalOpenArgs) => void;
  close: () => void;
};

type Props = {
  isReported: (accNormalized: string) => boolean;

  // toggle: ถ้ายังไม่เคยรายงาน -> report
  // ถ้าเคยรายงานแล้ว -> unreport
  onToggleReport: (payload: {
    mode: "REPORT" | "UNREPORT";
    bankName: string | null;
    account: string;
    category: BankCategory;
    note?: string;
    postId?: string;
    title?: string;
    source?: "HOME" | "MODAL";
  }) => Promise<void>;
};

export const BottomSheetReportBankModal = forwardRef<BottomSheetReportBankModalRef, Props>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    const [bankName, setBankName] = useState<string | null>(null);
    const [account, setAccount] = useState<string>("");

    const [postId, setPostId] = useState<string | undefined>(undefined);
    const [title, setTitle] = useState<string | undefined>(undefined);
    const [source, setSource] = useState<"HOME" | "MODAL">("HOME");

    const [category, setCategory] = useState<BankCategory>("SCAM");
    const [note, setNote] = useState<string>("");

    const [busy, setBusy] = useState(false);

    const reported = useMemo(() => {
      return account ? props.isReported(account) : false;
    }, [account, props]);

    useImperativeHandle(ref, () => ({
      open: (args) => {
        setBankName(args.bankName ?? null);
        setAccount(args.account);
        setPostId(args.postId);
        setTitle(args.title);
        setSource(args.source ?? "HOME");
        setCategory("SCAM");
        setNote("");
        setVisible(true);
      },
      close: () => setVisible(false),
    }));

    const onClose = () => setVisible(false);

    const onSubmit = async () => {
      if (!account) return;

      const mode: "REPORT" | "UNREPORT" = reported ? "UNREPORT" : "REPORT";

      setBusy(true);
      try {
        await props.onToggleReport({
          mode,
          bankName,
          account,
          category,
          note: note?.trim() ? note.trim() : undefined,
          postId,
          title,
          source,
        });
        setVisible(false);
      } finally {
        setBusy(false);
      }
    };

    if (!visible) return null;

    const primaryLabel = reported ? "ยกเลิกรายงาน" : "Report";
    const primaryIcon = reported ? "close-circle" : "megaphone";
    const primaryStyle = reported ? styles.primaryDanger : styles.primary;

    return (
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.hTitle}>รายงานบัญชีธนาคาร</Text>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </TouchableOpacity>
          </View>

          <Text style={styles.accLine}>
            {bankName ? `${bankName} · ` : ""}{account}
          </Text>

          {reported ? (
            <Text style={styles.reportedText}>
              ✓ คุณเคยรายงานบัญชีนี้แล้ว (ในเครื่อง)
            </Text>
          ) : (
            <Text style={styles.hintText}>
              รายงานนี้จะส่งข้อมูลให้ระบบ/แอดมินตรวจสอบ (ไม่บล็อกในเครื่อง)
            </Text>
          )}

          <View style={styles.divider} />

          <Text style={styles.section}>หมวดรายงาน</Text>
          <View style={styles.catRow}>
            <CatBtn label="Scam" active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
            <CatBtn label="Money Mule" active={category === "MONEY_MULE"} onPress={() => setCategory("MONEY_MULE")} />
            <CatBtn label="Sales/Ads" active={category === "SALES_ADS"} onPress={() => setCategory("SALES_ADS")} />
            <CatBtn label="Dispute" active={category === "DISPUTE"} onPress={() => setCategory("DISPUTE")} />
            <CatBtn label="Other" active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
          </View>

          <Text style={[styles.section, { marginTop: 14 }]}>รายละเอียด (ไม่บังคับ)</Text>
          <View style={styles.noteBox}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="เช่น หลอกโอน / ใช้บัญชีรับโอน / ฯลฯ"
              placeholderTextColor="#6b7280"
              style={styles.noteInput}
              maxLength={160}
              multiline
            />
            <Text style={styles.counter}>{note.length}/160</Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
              <Text style={styles.cancelText}>ยกเลิก</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.primaryBtn, primaryStyle]} onPress={onSubmit} disabled={busy}>
              <Ionicons name={primaryIcon as any} size={16} color="#111" />
              <Text style={styles.primaryText}>{busy ? "..." : primaryLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }
);

function CatBtn(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={props.onPress} style={[styles.catBtn, props.active && styles.catBtnActive]}>
      <Text style={[styles.catText, props.active && styles.catTextActive]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#111116",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "#2a2a35",
    padding: 14,
  },
  header: { flexDirection: "row", alignItems: "center" },
  hTitle: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "900" },
  closeBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "#1d1d25",
    borderWidth: 1, borderColor: "#2a2a35",
    alignItems: "center", justifyContent: "center",
  },

  accLine: { marginTop: 10, color: "#e5e7eb", fontSize: 14, fontWeight: "900" },
  reportedText: { marginTop: 6, color: "#34c759", fontSize: 12, fontWeight: "900" },
  hintText: { marginTop: 6, color: "#9ca3af", fontSize: 12, fontWeight: "800" },

  divider: { marginTop: 12, height: 1, backgroundColor: "#1f1f26" },

  section: { marginTop: 12, color: "#9ca3af", fontSize: 12, fontWeight: "900" },
  catRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  catBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1d1d25",
    borderWidth: 1, borderColor: "#2a2a35",
  },
  catBtnActive: { borderColor: "#34c759", backgroundColor: "rgba(52,199,89,0.18)" },
  catText: { color: "#e5e7eb", fontSize: 12, fontWeight: "900" },
  catTextActive: { color: "#34c759" },

  noteBox: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a35",
    backgroundColor: "#0b0b0f",
    padding: 10,
  },
  noteInput: { minHeight: 60, color: "#fff", fontSize: 13, fontWeight: "800" },
  counter: { marginTop: 6, color: "#6b7280", fontSize: 11, fontWeight: "900", alignSelf: "flex-end" },

  footer: { marginTop: 14, flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#1d1d25",
    borderWidth: 1,
    borderColor: "#2a2a35",
  },
  cancelText: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },

  primaryBtn: {
    flex: 1.3,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primary: { backgroundColor: "#34c759" },
  primaryDanger: { backgroundColor: "#ef4444" },
  primaryText: { color: "#111", fontSize: 13, fontWeight: "900" },
});