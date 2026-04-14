// src/components/BottomSheetReportBankModal.tsx
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useI18n } from "../i18n";

export type BankCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type BottomSheetReportBankModalOpenArgs = {
  bankName: string | null;
  account: string;            // normalized digits
  initialCategory?: BankCategory;
  initialNote?: string;
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

  onConfirm: (payload: {
    bankName: string | null;
    account: string;
    category: BankCategory;
    note: string;
    postId?: string;
    title?: string;
    source?: "HOME" | "MODAL";
  }) => Promise<void>;

  onUndo: (payload: {
    bankName: string | null;
    account: string;
  }) => Promise<void>;
};

export const BottomSheetReportBankModal = forwardRef<BottomSheetReportBankModalRef, Props>(
  (props, ref) => {
    const { t } = useI18n();

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
        setCategory(args.initialCategory ?? "SCAM");
        setNote(args.initialNote ?? "");
        setVisible(true);
      },
      close: () => setVisible(false),
    }));

    const onClose = () => setVisible(false);

    const onSubmit = async () => {
      if (!account) return;

      setBusy(true);
      try {
        await props.onConfirm({
          bankName,
          account,
          category,
          note,
          postId,
          title,
          source,
        });
        setVisible(false);
      } finally {
        setBusy(false);
      }
    };

    const onUndo = async () => {
      if (!account) return;
      setBusy(true);
      try {
        await props.onUndo({ bankName, account });
        setVisible(false);
      } finally {
        setBusy(false);
      }
    };

    if (!visible) return null;

    const primaryLabel = reported
      ? t("bank_report_modal.actions.update_report")
      : t("bank_report_modal.actions.report");
    const primaryIcon = reported ? "save-outline" : "megaphone-outline";
    const primaryStyle = styles.primary;

    return (
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.hTitle}>{t("bank_report_modal.title")}</Text>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color="#e5e7eb" />
            </TouchableOpacity>
          </View>

          <Text style={styles.accLine}>
            {bankName ? `${bankName} · ` : ""}{account}
          </Text>

          {reported ? (
            <Text style={styles.reportedText}>
              {t("bank_report_modal.already_reported")}
            </Text>
          ) : (
            <Text style={styles.hintText}>
              {t("bank_report_modal.hint")}
            </Text>
          )}

          <View style={styles.divider} />

          <Text style={styles.section}>{t("bank_report_modal.category_label")}</Text>
          <View style={styles.catRow}>
            <CatBtn label={t("bank_report_modal.categories.scam")} active={category === "SCAM"} onPress={() => setCategory("SCAM")} />
            <CatBtn label={t("bank_report_modal.categories.money_mule")} active={category === "MONEY_MULE"} onPress={() => setCategory("MONEY_MULE")} />
            <CatBtn label={t("bank_report_modal.categories.sales_ads")} active={category === "SALES_ADS"} onPress={() => setCategory("SALES_ADS")} />
            <CatBtn label={t("bank_report_modal.categories.dispute")} active={category === "DISPUTE"} onPress={() => setCategory("DISPUTE")} />
            <CatBtn label={t("bank_report_modal.categories.other")} active={category === "OTHER"} onPress={() => setCategory("OTHER")} />
          </View>

          <Text style={[styles.section, { marginTop: 14 }]}>{t("bank_report_modal.note_label")}</Text>
          <View style={styles.noteBox}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("bank_report_modal.note_placeholder")}
              placeholderTextColor="#6b7280"
              style={styles.noteInput}
              maxLength={160}
              multiline
            />
            <Text style={styles.counter}>{note.length}/160</Text>
          </View>

          <View style={styles.footer}>
            <ActionButton
              icon="close-outline"
              label={t("common.cancel")}
              variant="neutral"
              onPress={onClose}
              disabled={busy}
            />

            {reported ? (
              <ActionButton
                icon="refresh-outline"
                label={busy ? t("bank_report_modal.actions.processing") : t("bank_report_modal.actions.undo_report")}
                variant="danger"
                onPress={onUndo}
                disabled={busy}
              />
            ) : null}

            <ActionButton
              icon={primaryIcon as any}
              label={busy ? t("bank_report_modal.actions.processing") : primaryLabel}
              variant="success"
              onPress={onSubmit}
              disabled={busy}
            />
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

function ActionButton(props: {
  icon: string;
  label: string;
  variant: "neutral" | "danger" | "success";
  onPress: () => void;
  disabled?: boolean;
}) {
  const styleMap = {
    neutral: styles.actionNeutral,
    danger: styles.actionDanger,
    success: styles.actionSuccess,
  };

  const textMap = {
    neutral: styles.actionTextNeutral,
    danger: styles.actionTextDark,
    success: styles.actionTextDark,
  };

  const iconColor = props.variant === "neutral" ? "#e5e7eb" : "#101014";

  return (
    <TouchableOpacity
      style={[styles.actionBtn, styleMap[props.variant], props.disabled && styles.actionDisabled]}
      onPress={props.onPress}
      disabled={props.disabled}
      activeOpacity={0.82}
    >
      <Ionicons name={props.icon as any} size={16} color={iconColor} />
      <Text numberOfLines={1} style={[styles.actionTextBase, textMap[props.variant]]}>{props.label}</Text>
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

  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1f1f26",
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  actionNeutral: {
    backgroundColor: "#1d1d25",
    borderColor: "#2a2a35",
  },
  actionDanger: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
  actionSuccess: {
    backgroundColor: "#34c759",
    borderColor: "#34c759",
  },
  actionDisabled: { opacity: 0.72 },
  actionTextBase: { fontSize: 12, fontWeight: "900" },
  actionTextNeutral: { color: "#e5e7eb" },
  actionTextDark: { color: "#111" },

  primary: { backgroundColor: "#34c759" },
  primaryDanger: { backgroundColor: "#ef4444" },
  primaryText: { color: "#111", fontSize: 13, fontWeight: "900" },
});