import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useCallback, useMemo } from "react";

import { normalizeBankAccount, normalizeTel } from "../lib/jachoeiLocalState";

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
