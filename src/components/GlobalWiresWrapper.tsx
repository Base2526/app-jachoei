// src/components/GlobalWiresWrapper.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { AfterCallPopup } from "./AfterCallPopup";
import { usePhoneActions, type PhoneActionItem } from "../hooks/usePhoneActions";
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
  const { blockPhone, getPhoneInfo, logIgnoredPhone, reportPhone } = usePhoneActions();
  const {
    prompt,
    busy: spamPromptBusy,
    suggestFromPhone,
    onConfirmSpam,
    onSkip,
    onDontAskAgain,
  } = useSpamContactPrompt();
  const [afterCallItem, setAfterCallItem] = useState<PhoneActionItem | null>(null);
  const [afterCallBusy, setAfterCallBusy] = useState<"block" | "report" | null>(null);
  const popupSeenKey = useMemo(() => `jachoei.after_call_popup.last_id.v1.${user?.id ?? "guest"}`, [user?.id]);

  const maybeShowAfterCallPopup = useCallback(
    async (payload: { phone: string; rawPhone?: string | null; eventId?: number; risk?: number }) => {
      const phone = String(payload.phone || "").trim();
      if (!phone) return;

      if (typeof payload.eventId === "number") {
        const seen = Number((await AsyncStorage.getItem(popupSeenKey)) || 0) || 0;
        if (payload.eventId <= seen) return;
      }

      const info = await getPhoneInfo(phone);
      const risk = Math.max(Number(payload.risk || 0), Number(info?.risk_level || 0));
      const reportCount = Number(info?.report_count || 0);
      if (!info && risk < 7) return;

      setAfterCallItem(
        info ?? {
          phone,
          phone_normalized: phone,
          my_blocked: false,
          my_blocked_at: null,
          my_reported: false,
          my_reported_at: null,
          in_history: true,
          last_history_at: new Date().toISOString(),
          report_count: reportCount,
          last_report_at: null,
          risk_level: risk,
          updated_at: new Date().toISOString(),
          filters: ["ALL", "HISTORY"],
          tags: [],
        }
      );

      if (typeof payload.eventId === "number") {
        await AsyncStorage.setItem(popupSeenKey, String(payload.eventId));
      }
    },
    [getPhoneInfo, popupSeenKey]
  );

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

      void maybeShowAfterCallPopup({
        phone,
        rawPhone: payload?.raw_phone ?? phone,
        risk,
      });
    });
    return () => sub?.remove?.();
  }, [maybeShowAfterCallPopup, suggestFromPhone, t]);

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

        const latestEvent = [...events]
          .reverse()
          .find((event) => ["call", "sms"].includes(String(event.type || "")));

        if (latestEvent) {
          const meta = safeParseDetail(latestEvent.detail);
          if (meta?.action === "spam_warning" || meta?.action === "blocked_call") {
            await maybeShowAfterCallPopup({
              phone: latestEvent.phone_normalized,
              rawPhone: latestEvent.raw_phone,
              eventId: latestEvent.id,
            });
          }
        }

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
  }, [isLoggedIn, maybeShowAfterCallPopup, popupSeenKey, user?.id]);

  // ตัวอย่าง: ถ้า token หมดอายุจาก backend
  const forceLogout = async () => {
    await logout();
    navigation.reset({
      index: 0,
      routes: [{ name: "SignIn" }],
    });
  };

  if (booting) return null;

  return (
    <>
      {isLoggedIn && user ? <GlobalChatListener /> : null}
      {isLoggedIn && user ? (
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
      ) : null}
      <AfterCallPopup
        visible={!!afterCallItem}
        item={afterCallItem}
        busyAction={afterCallBusy}
        onBlock={() => {
          if (!afterCallItem) return;
          setAfterCallBusy("block");
          void blockPhone({
            phone: afterCallItem.phone_normalized,
            rawPhone: afterCallItem.phone,
            source: "after_call_popup",
            syncServer: isLoggedIn,
            appendLog: true,
          })
            .then(() => setAfterCallItem(null))
            .catch(() => {})
            .finally(() => setAfterCallBusy(null));
        }}
        onReport={() => {
          if (!afterCallItem) return;
          setAfterCallBusy("report");
          void reportPhone({
            phone: afterCallItem.phone_normalized,
            rawPhone: afterCallItem.phone,
            source: "after_call_popup",
            category: "SCAM",
            appendLog: true,
          })
            .then(() => setAfterCallItem(null))
            .catch(() => {})
            .finally(() => setAfterCallBusy(null));
        }}
        onIgnore={() => {
          if (afterCallItem) {
            void logIgnoredPhone(afterCallItem.phone_normalized, "after_call_popup", afterCallItem.phone);
          }
          setAfterCallItem(null);
        }}
      />
    </>
  );
}
