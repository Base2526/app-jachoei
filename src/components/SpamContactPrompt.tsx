import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useI18n } from "../i18n";

type Props = {
  visible: boolean;
  phone: string;
  displayName?: string;
  busy?: boolean;
  onConfirmSpam: () => void;
  onSkip: () => void;
  onDontAskAgain: () => void;
};

export function SpamContactPrompt(props: Props) {
  const { visible, phone, displayName, busy, onConfirmSpam, onSkip, onDontAskAgain } = props;
  const { t } = useI18n();

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onSkip}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{t("settings.contact_protection_title")}</Text>
          <Text style={styles.title}>{t("dialog.mark_contact_spam_confirm.title")}</Text>
          <Text style={styles.body}>
            {displayName ? `${displayName} • ` : ""}
            {phone}
          </Text>
          <Text style={styles.subtle}>
            {t("dialog.mark_contact_spam_confirm.message")}
          </Text>

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.ghost]} onPress={onSkip} disabled={busy}>
              <Text style={styles.ghostText}>{t("dialog.mark_contact_spam_confirm.cancel")}</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.primary, busy && styles.buttonDisabled]} onPress={onConfirmSpam} disabled={busy}>
              {busy ? <ActivityIndicator color="#111" size="small" /> : <Text style={styles.primaryText}>{t("dialog.mark_contact_spam_confirm.confirm")}</Text>}
            </Pressable>
          </View>

          <Pressable style={styles.linkButton} onPress={onDontAskAgain} disabled={busy}>
            <Text style={styles.linkText}>{t("dialog.mark_contact_spam_confirm.dont_ask_again")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 18,
    backgroundColor: "#12151a",
    borderWidth: 1,
    borderColor: "#2b3440",
    padding: 18,
  },
  eyebrow: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  body: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  ghost: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
  },
  ghostText: {
    color: "#cbd5e1",
    fontWeight: "600",
  },
  primary: {
    backgroundColor: "#fbbf24",
  },
  primaryText: {
    color: "#111",
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  linkButton: {
    marginTop: 12,
    alignSelf: "center",
    paddingVertical: 4,
  },
  linkText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
});