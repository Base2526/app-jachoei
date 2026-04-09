import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { getCallScreeningStatus } from "../native/CallBlocker";

export type CallerIdSpamUiStatus =
  | "checking"
  | "enabled"
  | "not_enabled"
  | "unsupported";

export type CallScreeningStatusPayload = Awaited<
  ReturnType<typeof getCallScreeningStatus>
>;

function mapUiStatus(
  status: CallScreeningStatusPayload | null
): CallerIdSpamUiStatus {
  if (Platform.OS !== "android") return "unsupported";
  if (!status) return "not_enabled";
  if (!status.supported) return "unsupported";
  if (status.enabled) return "enabled";
  return "not_enabled";
}

export function useCallScreeningStatus() {
  const [status, setStatus] = useState<CallScreeningStatusPayload | null>(null);
  const [uiStatus, setUiStatus] = useState<CallerIdSpamUiStatus>(
    Platform.OS === "android" ? "checking" : "unsupported"
  );
  const [refreshing, setRefreshing] = useState(Platform.OS === "android");

  const refreshStatus = useCallback(async () => {
    if (Platform.OS !== "android") {
      setStatus(null);
      setUiStatus("unsupported");
      setRefreshing(false);
      return null;
    }

    setRefreshing(true);
    setUiStatus((prev) => (prev === "enabled" ? prev : "checking"));

    try {
      const next = await getCallScreeningStatus();
      setStatus(next);
      setUiStatus(mapUiStatus(next));
      return next;
    } catch {
      setStatus(null);
      setUiStatus("not_enabled");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshStatus();
      }
    });

    return () => {
      sub.remove();
    };
  }, [refreshStatus]);

  return {
    status,
    uiStatus,
    refreshing,
    refreshStatus,
  };
}