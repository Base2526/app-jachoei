import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import {
  contactPromptSuppressionKey,
  type ContactMarkSource,
  useContactProtection,
} from "../lib/contactProtection";
import { normalizePhone } from "../lib/normalizePhone";
import {
  inspectContactPhone,
  markContactAsSpam,
  type ContactInspectResult,
  unmarkContactAsSpam,
} from "../native/ContactProtection";

type PromptState = {
  visible: boolean;
  phone: string;
  risk: number;
  source: ContactMarkSource;
  contact: ContactInspectResult | null;
};

type SuggestResult = "ignored" | "prompted" | "auto_marked";

const initialPrompt: PromptState = {
  visible: false,
  phone: "",
  risk: 0,
  source: "MANUAL",
  contact: null,
};

async function ensureContactPermissions(write: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  const permissions = write
    ? [PermissionsAndroid.PERMISSIONS.READ_CONTACTS, PermissionsAndroid.PERMISSIONS.WRITE_CONTACTS]
    : [PermissionsAndroid.PERMISSIONS.READ_CONTACTS];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

async function hasReadContactsPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
}

export function useSpamContactPrompt() {
  const { isLoggedIn, user } = useAuth();
  const { t } = useI18n();
  const { settings, markPhone, unmarkPhone } = useContactProtection({
    enabled: isLoggedIn,
    userId: user?.id ? String(user.id) : null,
  });

  const [prompt, setPrompt] = useState<PromptState>(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [contactMatch, setContactMatch] = useState<ContactInspectResult | null>(null);
  const lastSuggestedRef = useRef<{ phone: string; at: number } | null>(null);

  const currentPhone = useMemo(() => normalizePhone(prompt.phone || contactMatch?.matchedVariant || ""), [contactMatch?.matchedVariant, prompt.phone]);

  const inspectPhone = useCallback(async (phone: string) => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setContactMatch(null);
      return null;
    }

    const granted = await hasReadContactsPermission();
    if (!granted) {
      setContactMatch(null);
      return null;
    }

    const result = await inspectContactPhone(normalized);
    setContactMatch(result.found ? result : null);
    return result.found ? result : null;
  }, []);

  const requestPromptForCurrent = useCallback(() => {
    const phone = normalizePhone(contactMatch?.matchedVariant || contactMatch?.matchedNumber || "");
    if (!contactMatch?.found || contactMatch.spamMarked || !phone) return;
    setPrompt({
      visible: true,
      phone,
      risk: 100,
      source: "MANUAL",
      contact: contactMatch,
    });
  }, [contactMatch]);

  const suggestFromPhone = useCallback(
    async (phone: string, risk: number): Promise<SuggestResult> => {
      const normalized = normalizePhone(phone);
      if (!normalized) return "ignored";
      if (settings.mode === "OFF") return "ignored";
      if (risk < settings.riskThreshold) return "ignored";

      const suppressed = (await AsyncStorage.getItem(contactPromptSuppressionKey(normalized))) === "1";
      if (suppressed) return "ignored";

      const last = lastSuggestedRef.current;
      if (last && last.phone === normalized && Date.now() - last.at < 15_000) return "ignored";

      const result = await inspectPhone(normalized);
      if (!result?.found || result.spamMarked) return "ignored";

      lastSuggestedRef.current = { phone: normalized, at: Date.now() };

      if (settings.mode === "AUTO" && settings.autoMarkEnabled) {
        const granted = await ensureContactPermissions(true);
        if (!granted) return "ignored";

        setBusy(true);
        try {
          const updated = await markContactAsSpam(normalized);
          if (!updated.found) return "ignored";
          await markPhone(normalized, updated.displayName, "AUTO");
          setContactMatch(updated);
          return "auto_marked";
        } finally {
          setBusy(false);
        }
      }

      setPrompt({
        visible: true,
        phone: normalized,
        risk,
        source: "SUGGESTED",
        contact: result,
      });
      return "prompted";
    },
    [inspectPhone, markPhone, settings.autoMarkEnabled, settings.mode, settings.riskThreshold]
  );

  const onConfirmSpam = useCallback(async () => {
    const phone = normalizePhone(prompt.phone || currentPhone);
    if (!phone) return;

    const granted = await ensureContactPermissions(true);
    if (!granted) {
      Alert.alert(t("dialog.permission_contacts_required.title"), t("dialog.permission_contacts_required.message"));
      return;
    }

    setBusy(true);
    try {
      const updated = await markContactAsSpam(phone);
      if (!updated.found) {
        setPrompt(initialPrompt);
        return;
      }
      await markPhone(phone, updated.displayName, prompt.source);
      setContactMatch(updated);
      setPrompt(initialPrompt);
    } finally {
      setBusy(false);
    }
  }, [currentPhone, markPhone, prompt.phone, prompt.source]);

  const onSkip = useCallback(() => {
    setPrompt(initialPrompt);
  }, []);

  const onDontAskAgain = useCallback(async () => {
    const phone = normalizePhone(prompt.phone || currentPhone);
    if (!phone) {
      setPrompt(initialPrompt);
      return;
    }
    await AsyncStorage.setItem(contactPromptSuppressionKey(phone), "1");
    setPrompt(initialPrompt);
  }, [currentPhone, prompt.phone]);

  const unmarkCurrentContact = useCallback(async () => {
    const phone = normalizePhone(prompt.phone || currentPhone || contactMatch?.matchedNumber || "");
    if (!phone) return;

    const granted = await ensureContactPermissions(true);
    if (!granted) {
      Alert.alert(t("dialog.permission_contacts_required.title"), t("dialog.permission_contacts_required.message"));
      return;
    }

    setBusy(true);
    try {
      const updated = await unmarkContactAsSpam(phone);
      await unmarkPhone(phone);
      setContactMatch(updated.found ? updated : null);
      if (prompt.visible) setPrompt(initialPrompt);
    } finally {
      setBusy(false);
    }
  }, [contactMatch?.matchedNumber, currentPhone, prompt.phone, prompt.visible, t, unmarkPhone]);

  return {
    prompt,
    busy,
    contactMatch,
    settings,
    inspectPhone,
    requestPromptForCurrent,
    suggestFromPhone,
    onConfirmSpam,
    onSkip,
    onDontAskAgain,
    unmarkCurrentContact,
  };
}