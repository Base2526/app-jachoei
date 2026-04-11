// src/components/GlobalWiresWrapper.tsx
import React, { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { GlobalChatListener } from "./GlobalChatListener";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { gql } from "@apollo/client";
import { client } from "../apollo/client";
import { addIncomingSpamCallListener, getIncomingCallEvents, type IncomingCallEvent } from "../native/CallBlocker";
import { SpamContactPrompt } from "./SpamContactPrompt";
import { useSpamContactPrompt } from "../hooks/useSpamContactPrompt";
import Toast from "react-native-toast-message";

const M_INGEST_CALL_LOGS = gql`
  mutation IngestCallLogs($logs: [LogCallInput!]!) {
    ingestCallLogs(logs: $logs)
  }
`;

function safeParseDetail(detail: string | null | undefined): { action?: string; source?: string; matched_by?: string } | null {
  if (!detail) return null;
  try {
    const obj = JSON.parse(String(detail));
    if (!obj || typeof obj !== "object") return null;
    return {
      action: typeof (obj as any).action === "string" ? (obj as any).action : undefined,
      source: typeof (obj as any).source === "string" ? (obj as any).source : undefined,
      matched_by: typeof (obj as any).matched_by === "string" ? (obj as any).matched_by : undefined,
    };
  } catch {
    return null;
  }
}

export function GlobalWiresWrapper() {
  const navigation = useNavigation<any>();
  const { user, isLoggedIn, booting, logout } = useAuth();
  const { t } = useI18n();
  const {
    prompt,
    busy: spamPromptBusy,
    suggestFromPhone,
    onConfirmSpam,
    onSkip,
    onDontAskAgain,
  } = useSpamContactPrompt();

  useEffect(() => {
    const sub = addIncomingSpamCallListener?.((payload) => {
      const phone = String(payload?.phone_normalized || "");
      if (!phone) return;
      const risk = Number(payload?.risk || 0);
      Toast.show({
        type: "info",
        text1: t("call_screening.incoming_spam_warning"),
        text2: risk > 0 ? `${phone} (risk ${risk})` : phone,
        visibilityTime: 4500,
      });
      void suggestFromPhone(phone, risk).then((result) => {
        if (result === "auto_marked") {
          Toast.show({
            type: "success",
            text1: t("toast.mark_spam_success"),
            text2: phone,
            visibilityTime: 3500,
          });
        }
      });
    });
    return () => sub?.remove?.();
  }, [suggestFromPhone, t]);

  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;

    const key = `jachoei.call_logs.last_id.v1.${user.id}`;
    let cancelled = false;

    async function uploadOnce() {
      try {
        const raw = await AsyncStorage.getItem(key);
        const sinceId = Math.max(0, Number(raw || 0) || 0);

        const events: IncomingCallEvent[] = await getIncomingCallEvents(sinceId, 200);
        if (cancelled) return;
        if (!Array.isArray(events) || events.length === 0) return;

        const logs = events
          .map((e) => {
            const meta = safeParseDetail(e.detail);
            if (!meta?.action || !meta?.source) return null;
            return {
              normalized_number: String(e.phone_normalized || "").trim(),
              type: e.type,
              source: meta.source,
              action: meta.action,
              matched_by: meta.matched_by ?? null,
              // created_at from SQLite is local time string; let server default if it doesn't parse.
              created_at: e.created_at,
            };
          })
          .filter(Boolean);

        if (logs.length === 0) {
          const maxId = Math.max(...events.map((e) => e.id));
          await AsyncStorage.setItem(key, String(maxId));
          return;
        }

        await client.mutate({
          mutation: M_INGEST_CALL_LOGS,
          variables: { logs },
          fetchPolicy: "no-cache",
        });

        const maxId = Math.max(...events.map((e) => e.id));
        await AsyncStorage.setItem(key, String(maxId));
      } catch {
        // best-effort only
      }
    }

    void uploadOnce();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void uploadOnce();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [isLoggedIn, user?.id]);

  // ตัวอย่าง: ถ้า token หมดอายุจาก backend
  const forceLogout = async () => {
    await logout();
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  if (booting) return null; // หรือ splash

  // ยังไม่ login → ไม่ต้องเปิด socket / chat
  if (!isLoggedIn || !user) return null;

  return (
    <>
      <GlobalChatListener />
      <SpamContactPrompt
        visible={prompt.visible}
        phone={prompt.phone}
        displayName={prompt.contact?.displayName}
        busy={spamPromptBusy}
        onConfirmSpam={() => {
          void onConfirmSpam();
        }}
        onSkip={onSkip}
        onDontAskAgain={() => {
          void onDontAskAgain();
        }}
      />
    </>
  );
}
