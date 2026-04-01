import { gql } from "@apollo/client";
import { useQuery, useSubscription } from "@apollo/client/react";
import { useCallback, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { normalizeBankAccount, normalizeTel } from "../lib/jachoeiLocalState";
import { syncBlockedNumbers } from "../native/CallBlocker";

export const Q_MY_BLOCKED_PHONE_KEYS = gql`
  query MyBlockedPhoneKeys {
    myBlockedPhoneKeys
  }
`;

export const Q_MY_REPORTED_BANK_ACCOUNT_KEYS = gql`
  query MyReportedBankAccountKeys {
    myReportedBankAccountKeys
  }
`;

const S_MY_PHONE_BLOCK_STATUS_CHANGED = gql`
  subscription MyPhoneBlockStatusChanged {
    myPhoneBlockStatusChanged {
      user_id
      action
      phone_normalized
      blocked
      updated_at
    }
  }
`;

const S_MY_BANK_BLOCK_STATUS_CHANGED = gql`
  subscription MyBankBlockStatusChanged {
    myBankBlockStatusChanged {
      user_id
      action
      bank_name
      account_norm
      blocked
      updated_at
    }
  }
`;

type UseJachoeiStatusKeysArgs = {
  enabled: boolean;
};

export function useJachoeiStatusKeys(args: UseJachoeiStatusKeysArgs) {
  const blockedQ = useQuery<{ myBlockedPhoneKeys: string[] }>(Q_MY_BLOCKED_PHONE_KEYS, {
    skip: !args.enabled,
    fetchPolicy: "cache-and-network",
    errorPolicy: "all",
  });

  const reportedBankQ = useQuery<{ myReportedBankAccountKeys: string[] }>(Q_MY_REPORTED_BANK_ACCOUNT_KEYS, {
    skip: !args.enabled,
    fetchPolicy: "cache-and-network",
    errorPolicy: "all",
  });

  const blockedSet = useMemo(() => {
    const keys: string[] = blockedQ.data?.myBlockedPhoneKeys ?? [];
    return new Set(keys.map((k: string) => String(k || "").trim()).filter(Boolean));
  }, [blockedQ.data?.myBlockedPhoneKeys]);

  // Keep native/local DB in sync for offline call screening (best-effort).
  useEffect(() => {
    if (!args.enabled) return;
    const keys: string[] = blockedQ.data?.myBlockedPhoneKeys ?? [];
    if (!keys.length) return;
    void syncBlockedNumbers(keys).catch(() => {});
  }, [args.enabled, blockedQ.data?.myBlockedPhoneKeys]);

  const reportedBankSet = useMemo(() => {
    const keys: string[] = reportedBankQ.data?.myReportedBankAccountKeys ?? [];
    return new Set(keys.map((k: string) => String(k || "").trim()).filter(Boolean));
  }, [reportedBankQ.data?.myReportedBankAccountKeys]);

  const isBlockedTel = useCallback(
    (telRaw: string): boolean => {
      const k = normalizeTel(telRaw);
      if (!k) return false;
      return blockedSet.has(k);
    },
    [blockedSet]
  );

  const isReportedBank = useCallback(
    (accountRaw: string): boolean => {
      const k = normalizeBankAccount(accountRaw);
      if (!k) return false;
      return reportedBankSet.has(k);
    },
    [reportedBankSet]
  );

  const refetchAll = useCallback(async () => {
    await Promise.allSettled([
      args.enabled ? blockedQ.refetch() : Promise.resolve(),
      args.enabled ? reportedBankQ.refetch() : Promise.resolve(),
    ]);
  }, [args.enabled, blockedQ.refetch, reportedBankQ.refetch]);

  // Fallback reconciliation: if subscription was missed while backgrounded.
  useEffect(() => {
    if (!args.enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchAll();
    });
    return () => sub.remove();
  }, [args.enabled, refetchAll]);

  // Realtime: same-user multi-device sync (subscription is a hint; DB remains source of truth)
  useSubscription(S_MY_PHONE_BLOCK_STATUS_CHANGED, {
    skip: !args.enabled,
    onData: () => {
      if (!args.enabled) return;
      void blockedQ.refetch().catch(() => {});
    },
  });

  useSubscription(S_MY_BANK_BLOCK_STATUS_CHANGED, {
    skip: !args.enabled,
    onData: () => {
      if (!args.enabled) return;
      void reportedBankQ.refetch().catch(() => {});
    },
  });

  return useMemo(
    () => ({
      isBlockedTel,
      isReportedBank,
      blockedKeys: blockedQ.data?.myBlockedPhoneKeys ?? [],
      reportedBankKeys: reportedBankQ.data?.myReportedBankAccountKeys ?? [],
      loading: !!(args.enabled && (blockedQ.loading || reportedBankQ.loading)),
      errors: [blockedQ.error, reportedBankQ.error].filter(Boolean),
      refetchAll,
    }),
    [
      args.enabled,
      blockedQ.data?.myBlockedPhoneKeys,
      blockedQ.error,
      blockedQ.loading,
      isBlockedTel,
      isReportedBank,
      refetchAll,
      reportedBankQ.data?.myReportedBankAccountKeys,
      reportedBankQ.error,
      reportedBankQ.loading,
    ]
  );
}
