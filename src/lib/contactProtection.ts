import AsyncStorage from "@react-native-async-storage/async-storage";
import { gql } from "@apollo/client";
import { useQuery, useSubscription } from "@apollo/client/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { client } from "../apollo/client";
import { normalizePhone } from "./normalizePhone";

export type ContactProtectionMode = "OFF" | "PROMPT" | "AUTO";
export type ContactMarkSource = "MANUAL" | "SUGGESTED" | "AUTO";

export type ContactProtectionSettings = {
  mode: ContactProtectionMode;
  riskThreshold: number;
  syncEnabled: boolean;
  autoMarkEnabled: boolean;
  updatedAt?: string;
};

type ContactProtectionSettingsQuery = {
  myContactSpamProtectionSettings: {
    user_id: string;
    mode: string;
    risk_threshold: number;
    sync_enabled: boolean;
    auto_mark_enabled: boolean;
    updated_at: string;
  };
};

type ContactProtectionMarkedKeysQuery = {
  myContactSpamMarkedPhoneKeys: string[];
};

type ContactProtectionSettingsMutation = {
  updateMyContactSpamProtectionSettings: {
    user_id: string;
    mode: string;
    risk_threshold: number;
    sync_enabled: boolean;
    auto_mark_enabled: boolean;
    updated_at: string;
  };
};

type ContactSpamMarkMutation = {
  markContactSpamPhone: {
    phone_normalized: string;
  };
};

type ContactSpamUnmarkMutation = {
  unmarkContactSpamPhone: {
    phone_normalized: string;
  };
};

const DEFAULT_SETTINGS: ContactProtectionSettings = {
  mode: "PROMPT",
  riskThreshold: 75,
  syncEnabled: true,
  autoMarkEnabled: false,
};

export const Q_MY_CONTACT_SPAM_PROTECTION_SETTINGS = gql`
  query MyContactSpamProtectionSettings {
    myContactSpamProtectionSettings {
      user_id
      mode
      risk_threshold
      sync_enabled
      auto_mark_enabled
      updated_at
    }
  }
`;

export const Q_MY_CONTACT_SPAM_MARKED_PHONE_KEYS = gql`
  query MyContactSpamMarkedPhoneKeys {
    myContactSpamMarkedPhoneKeys
  }
`;

const S_MY_CONTACT_SPAM_MARK_CHANGED = gql`
  subscription MyContactSpamMarkChanged {
    myContactSpamMarkChanged {
      user_id
      action
      phone_normalized
      active
      updated_at
    }
  }
`;

const S_MY_CONTACT_SPAM_SETTINGS_CHANGED = gql`
  subscription MyContactSpamSettingsChanged {
    myContactSpamSettingsChanged {
      user_id
      mode
      risk_threshold
      sync_enabled
      auto_mark_enabled
      updated_at
    }
  }
`;

const M_UPDATE_CONTACT_SPAM_PROTECTION_SETTINGS = gql`
  mutation UpdateMyContactSpamProtectionSettings($input: ContactSpamProtectionSettingsInput!) {
    updateMyContactSpamProtectionSettings(input: $input) {
      user_id
      mode
      risk_threshold
      sync_enabled
      auto_mark_enabled
      updated_at
    }
  }
`;

const M_MARK_CONTACT_SPAM_PHONE = gql`
  mutation MarkContactSpamPhone($phone: String!, $contact_name: String, $source: ContactSpamMarkSource) {
    markContactSpamPhone(phone: $phone, contact_name: $contact_name, source: $source) {
      phone_normalized
    }
  }
`;

const M_UNMARK_CONTACT_SPAM_PHONE = gql`
  mutation UnmarkContactSpamPhone($phone: String!) {
    unmarkContactSpamPhone(phone: $phone) {
      phone_normalized
    }
  }
`;

function settingsStorageKey(userId: string) {
  return `jachoei.contact_protection.settings.v1.${userId || "guest"}`;
}

function marksStorageKey(userId: string) {
  return `jachoei.contact_protection.marks.v1.${userId || "guest"}`;
}

export function contactPromptSuppressionKey(phone: string) {
  return `jachoei.contact_protection.prompt_skip.v1.${normalizePhone(phone)}`;
}

function normalizeMode(value: unknown): ContactProtectionMode {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "OFF" || mode === "AUTO") return mode;
  return "PROMPT";
}

function clampThreshold(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.riskThreshold;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseSettings(value: Partial<ContactProtectionSettingsQuery["myContactSpamProtectionSettings"]> | null | undefined): ContactProtectionSettings {
  return {
    mode: normalizeMode(value?.mode),
    riskThreshold: clampThreshold(value?.risk_threshold),
    syncEnabled: value?.sync_enabled !== false,
    autoMarkEnabled: value?.auto_mark_enabled === true,
    updatedAt: value?.updated_at ? String(value.updated_at) : undefined,
  };
}

async function loadStoredSettings(userId: string): Promise<ContactProtectionSettings> {
  try {
    const raw = await AsyncStorage.getItem(settingsStorageKey(userId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as ContactProtectionSettings;
    return {
      mode: normalizeMode(parsed?.mode),
      riskThreshold: clampThreshold(parsed?.riskThreshold),
      syncEnabled: parsed?.syncEnabled !== false,
      autoMarkEnabled: parsed?.autoMarkEnabled === true,
      updatedAt: parsed?.updatedAt,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function persistStoredSettings(userId: string, value: ContactProtectionSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(settingsStorageKey(userId), JSON.stringify(value));
  } catch {
    // best-effort only
  }
}

async function loadStoredMarks(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(marksStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => normalizePhone(String(value || ""))).filter(Boolean);
  } catch {
    return [];
  }
}

async function persistStoredMarks(userId: string, values: string[]): Promise<void> {
  try {
    const uniqueValues = Array.from(new Set(values.map((value) => normalizePhone(value)).filter(Boolean))).sort();
    await AsyncStorage.setItem(marksStorageKey(userId), JSON.stringify(uniqueValues));
  } catch {
    // best-effort only
  }
}

function mergeMarks(values: string[], nextValue: string, active: boolean): string[] {
  const set = new Set(values.map((value) => normalizePhone(value)).filter(Boolean));
  const key = normalizePhone(nextValue);
  if (!key) return Array.from(set);
  if (active) set.add(key);
  else set.delete(key);
  return Array.from(set).sort();
}

type UseContactProtectionArgs = {
  enabled: boolean;
  userId: string | null | undefined;
};

export function useContactProtection(args: UseContactProtectionArgs) {
  const storageUserId = String(args.userId || "guest");
  const [settings, setSettings] = useState<ContactProtectionSettings>(DEFAULT_SETTINGS);
  const [markedKeys, setMarkedKeys] = useState<string[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  const settingsQ = useQuery<ContactProtectionSettingsQuery>(Q_MY_CONTACT_SPAM_PROTECTION_SETTINGS, {
    skip: !args.enabled,
    fetchPolicy: "cache-and-network",
    errorPolicy: "all",
  });

  const marksQ = useQuery<ContactProtectionMarkedKeysQuery>(Q_MY_CONTACT_SPAM_MARKED_PHONE_KEYS, {
    skip: !args.enabled,
    fetchPolicy: "cache-and-network",
    errorPolicy: "all",
  });

  useEffect(() => {
    let cancelled = false;
    setStorageLoaded(false);

    void (async () => {
      const [storedSettings, storedMarks] = await Promise.all([
        loadStoredSettings(storageUserId),
        loadStoredMarks(storageUserId),
      ]);

      if (cancelled) return;
      setSettings(storedSettings);
      setMarkedKeys(storedMarks);
      setStorageLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [storageUserId]);

  useEffect(() => {
    if (!args.enabled || !settingsQ.data?.myContactSpamProtectionSettings) return;
    const next = parseSettings(settingsQ.data.myContactSpamProtectionSettings);
    setSettings(next);
    void persistStoredSettings(storageUserId, next);
  }, [args.enabled, settingsQ.data?.myContactSpamProtectionSettings, storageUserId]);

  useEffect(() => {
    if (!args.enabled || !settings.syncEnabled) return;
    const keys = marksQ.data?.myContactSpamMarkedPhoneKeys;
    if (!Array.isArray(keys)) return;
    const normalized = Array.from(new Set(keys.map((value) => normalizePhone(value)).filter(Boolean))).sort();
    setMarkedKeys(normalized);
    void persistStoredMarks(storageUserId, normalized);
  }, [args.enabled, marksQ.data?.myContactSpamMarkedPhoneKeys, settings.syncEnabled, storageUserId]);

  const refetchAll = useCallback(async () => {
    await Promise.allSettled([
      args.enabled ? settingsQ.refetch() : Promise.resolve(),
      args.enabled && settings.syncEnabled ? marksQ.refetch() : Promise.resolve(),
    ]);
  }, [args.enabled, marksQ, settings.syncEnabled, settingsQ]);

  useEffect(() => {
    if (!args.enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchAll();
    });
    return () => sub.remove();
  }, [args.enabled, refetchAll]);

  useSubscription(S_MY_CONTACT_SPAM_MARK_CHANGED, {
    skip: !args.enabled || !settings.syncEnabled,
    onData: () => {
      if (!args.enabled || !settings.syncEnabled) return;
      void marksQ.refetch().catch(() => {});
    },
  });

  useSubscription(S_MY_CONTACT_SPAM_SETTINGS_CHANGED, {
    skip: !args.enabled,
    onData: () => {
      if (!args.enabled) return;
      void settingsQ.refetch().catch(() => {});
    },
  });

  const updateSettings = useCallback(
    async (patch: Partial<ContactProtectionSettings>) => {
      const next: ContactProtectionSettings = {
        mode: normalizeMode(patch.mode ?? settings.mode),
        riskThreshold: clampThreshold(patch.riskThreshold ?? settings.riskThreshold),
        syncEnabled: patch.syncEnabled ?? settings.syncEnabled,
        autoMarkEnabled: patch.autoMarkEnabled ?? settings.autoMarkEnabled,
        updatedAt: settings.updatedAt,
      };

      setSettings(next);
      await persistStoredSettings(storageUserId, next);

      if (!args.enabled) return next;

      const result = await client.mutate<ContactProtectionSettingsMutation>({
        mutation: M_UPDATE_CONTACT_SPAM_PROTECTION_SETTINGS,
        variables: {
          input: {
            mode: next.mode,
            risk_threshold: next.riskThreshold,
            sync_enabled: next.syncEnabled,
            auto_mark_enabled: next.autoMarkEnabled,
          },
        },
        fetchPolicy: "no-cache",
      });

      const saved = parseSettings(result.data?.updateMyContactSpamProtectionSettings);
      setSettings(saved);
      await persistStoredSettings(storageUserId, saved);

      if (saved.syncEnabled && !settings.syncEnabled && markedKeys.length > 0) {
        await Promise.allSettled(
          markedKeys.map((phone) =>
            client.mutate<ContactSpamMarkMutation>({
              mutation: M_MARK_CONTACT_SPAM_PHONE,
              variables: { phone, source: "MANUAL" },
              fetchPolicy: "no-cache",
            })
          )
        );
      }

      return saved;
    },
    [args.enabled, markedKeys, settings, storageUserId]
  );

  const markPhone = useCallback(
    async (phone: string, contactName?: string | null, source: ContactMarkSource = "MANUAL") => {
      const key = normalizePhone(phone);
      if (!key) return false;

      setMarkedKeys((current) => {
        const next = mergeMarks(current, key, true);
        void persistStoredMarks(storageUserId, next);
        return next;
      });

      if (!args.enabled || !settings.syncEnabled) return true;

      await client.mutate<ContactSpamMarkMutation>({
        mutation: M_MARK_CONTACT_SPAM_PHONE,
        variables: {
          phone: key,
          contact_name: contactName?.trim() ? contactName.trim() : null,
          source,
        },
        fetchPolicy: "no-cache",
      });
      return true;
    },
    [args.enabled, settings.syncEnabled, storageUserId]
  );

  const unmarkPhone = useCallback(
    async (phone: string) => {
      const key = normalizePhone(phone);
      if (!key) return false;

      setMarkedKeys((current) => {
        const next = mergeMarks(current, key, false);
        void persistStoredMarks(storageUserId, next);
        return next;
      });

      if (!args.enabled || !settings.syncEnabled) return true;

      await client.mutate<ContactSpamUnmarkMutation>({
        mutation: M_UNMARK_CONTACT_SPAM_PHONE,
        variables: { phone: key },
        fetchPolicy: "no-cache",
      });
      return true;
    },
    [args.enabled, settings.syncEnabled, storageUserId]
  );

  const markedSet = useMemo(() => new Set(markedKeys), [markedKeys]);

  const isMarkedPhone = useCallback(
    (phone: string) => {
      const key = normalizePhone(phone);
      if (!key) return false;
      return markedSet.has(key);
    },
    [markedSet]
  );

  return {
    settings,
    markedKeys,
    markedSet,
    loading: !storageLoaded || (args.enabled && (settingsQ.loading || (settings.syncEnabled && marksQ.loading))),
    errors: [settingsQ.error, marksQ.error].filter(Boolean),
    updateSettings,
    markPhone,
    unmarkPhone,
    isMarkedPhone,
    refetchAll,
  };
}