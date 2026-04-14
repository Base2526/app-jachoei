import { useCallback } from "react";
import { Platform } from "react-native";

import { client } from "../apollo/client";
import { useAuth } from "../auth/AuthProvider";
import { normalizePhone } from "../lib/normalizePhone";
import { addBlockedNumber, removeBlockedNumber } from "../native/CallBlocker";
import {
  M_BLOCK_PHONE_ACTION,
  M_REPORT_PHONE_ACTION,
  M_UNBLOCK_PHONE_ACTION,
  Q_GET_PHONE_INFO,
} from "../graphql/phoneActions";
import {
  appendBlockedLog,
  getLocalPhoneInfo,
  setLocalBlocked,
  upsertLocalPhoneInfo,
  type LocalPhoneInfo,
} from "../lib/phoneActionsDb";

export type PhoneActionItem = {
  phone: string;
  phone_normalized: string;
  my_blocked: boolean;
  my_blocked_at: string | null;
  my_reported: boolean;
  my_reported_at: string | null;
  in_history: boolean;
  last_history_at: string | null;
  report_count: number;
  last_report_at: string | null;
  risk_level: number;
  updated_at: string;
  post_count: number;
  latest_post_id: string | null;
  post_ids: string[];
  filters: string[];
  tags: string[];
};

export type PhoneActionSource =
  | "phone_center_card"
  | "phone_center_fab"
  | "after_call_popup"
  | "manual"
  | "unknown";

type BlockPayload = {
  phone: string;
  source?: PhoneActionSource;
  rawPhone?: string | null;
  type?: "call" | "sms";
  syncServer?: boolean;
  appendLog?: boolean;
};

type ReportPayload = {
  phone: string;
  category?: "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
  note?: string | null;
  source?: PhoneActionSource;
  rawPhone?: string | null;
  type?: "call" | "sms";
  appendLog?: boolean;
};

function buildFilters(item: { my_blocked?: boolean; my_reported?: boolean; in_history?: boolean }) {
  const filters = ["ALL"];
  if (item.my_blocked) filters.push("BLOCKED");
  if (item.my_reported) filters.push("REPORTS");
  if (item.in_history) filters.push("HISTORY");
  return filters;
}

function fromLocalInfo(local: LocalPhoneInfo): PhoneActionItem {
  const now = local.updated_at ?? new Date().toISOString();
  const item = {
    phone: local.phone,
    phone_normalized: local.phone_normalized,
    my_blocked: local.local_blocked,
    my_blocked_at: local.local_blocked ? now : null,
    my_reported: false,
    my_reported_at: null,
    in_history: false,
    last_history_at: null,
    report_count: local.report_count,
    last_report_at: local.last_report_at,
    risk_level: local.risk_level,
    updated_at: now,
    post_count: 0,
    latest_post_id: null,
    post_ids: [],
    tags: local.tags,
  };

  return {
    ...item,
    filters: buildFilters(item),
  };
}

function fromServerItem(item: any, tags: string[] = []): PhoneActionItem {
  const next = {
    phone: String(item?.phone || item?.phone_normalized || ""),
    phone_normalized: normalizePhone(String(item?.phone_normalized || item?.phone || "")),
    my_blocked: !!item?.my_blocked,
    my_blocked_at: item?.my_blocked_at ? String(item.my_blocked_at) : null,
    my_reported: !!item?.my_reported,
    my_reported_at: item?.my_reported_at ? String(item.my_reported_at) : null,
    in_history: !!item?.in_history,
    last_history_at: item?.last_history_at ? String(item.last_history_at) : null,
    report_count: Number(item?.report_count || 0),
    last_report_at: item?.last_report_at ? String(item.last_report_at) : null,
    risk_level: Number(item?.risk_level || 0),
    updated_at: item?.updated_at ? String(item.updated_at) : new Date().toISOString(),
    post_count: Number(item?.post_count || 0),
    latest_post_id: item?.latest_post_id ? String(item.latest_post_id) : null,
    post_ids: Array.isArray(item?.post_ids) ? item.post_ids.map((value: any) => String(value)) : [],
    tags,
  };

  return {
    ...next,
    filters: Array.isArray(item?.filters) && item.filters.length > 0 ? item.filters : buildFilters(next),
  };
}

function detailJson(source: PhoneActionSource, action: string, note?: string | null) {
  return JSON.stringify({ source, action, note: note ?? null });
}

export function usePhoneActions() {
  const { isLoggedIn } = useAuth();

  const normalizePhoneNumber = useCallback((raw: string) => normalizePhone(raw), []);

  const getPhoneInfo = useCallback(async (phoneRaw: string): Promise<PhoneActionItem | null> => {
    const phone = normalizePhone(phoneRaw);
    if (!phone) return null;

    const local = await getLocalPhoneInfo(phone);

    try {
      const res = await client.query<{ getPhoneInfo: any }>({
        query: Q_GET_PHONE_INFO,
        variables: { phone },
        fetchPolicy: "network-only",
      });

      const info = res.data?.getPhoneInfo;
      if (info && !info.is_deleted) {
        const localRow = await upsertLocalPhoneInfo({
          phone,
          report_count: Number(info.report_count || 0),
          risk_level: Number(info.risk_level || 0),
          tags: Array.isArray(info.tags) ? info.tags : [],
          last_report_at: info.last_report_at ? String(info.last_report_at) : null,
          updated_at: info.updated_at ? String(info.updated_at) : new Date().toISOString(),
          local_blocked: local?.local_blocked ?? false,
        });
        return fromLocalInfo(localRow);
      }
    } catch {
      // fall back to local cache only
    }

    return local ? fromLocalInfo(local) : null;
  }, []);

  const blockPhone = useCallback(
    async (payload: BlockPayload): Promise<PhoneActionItem> => {
      const phone = normalizePhone(payload.phone);
      if (!phone) throw new Error("Invalid phone");

      const source = payload.source ?? "unknown";
      const localRow = await setLocalBlocked(phone, true);

      if (Platform.OS === "android") {
        try {
          await addBlockedNumber(phone);
        } catch {
          // best effort only
        }
      }

      if (payload.appendLog) {
        await appendBlockedLog({
          phone,
          rawPhone: payload.rawPhone ?? phone,
          type: payload.type ?? "call",
          detail: detailJson(source, "blocked_call"),
        });
      }

      if (payload.syncServer !== false && isLoggedIn) {
        try {
          const res = await client.mutate<{ blockNumber: { item: any } }>({
            mutation: M_BLOCK_PHONE_ACTION,
            variables: { phoneNumber: phone },
            fetchPolicy: "no-cache",
          });

          const item = res.data?.blockNumber?.item;
          if (item) {
            const tags = localRow.tags;
            const next = fromServerItem(item, tags);
            await upsertLocalPhoneInfo({
              phone,
              report_count: next.report_count,
              risk_level: next.risk_level,
              tags: next.tags,
              last_report_at: next.last_report_at,
              updated_at: next.updated_at,
              local_blocked: true,
            });
            return next;
          }
        } catch {
          // keep local success even if sync fails
        }
      }

      return fromLocalInfo(localRow);
    },
    [isLoggedIn]
  );

  const unblockPhone = useCallback(
    async (payload: BlockPayload): Promise<PhoneActionItem> => {
      const phone = normalizePhone(payload.phone);
      if (!phone) throw new Error("Invalid phone");

      const localRow = await setLocalBlocked(phone, false);

      if (Platform.OS === "android") {
        try {
          await removeBlockedNumber(phone);
        } catch {
          // best effort only
        }
      }

      if (payload.syncServer !== false && isLoggedIn) {
        try {
          const res = await client.mutate<{ unblockNumber: { item: any } }>({
            mutation: M_UNBLOCK_PHONE_ACTION,
            variables: { phoneNumber: phone },
            fetchPolicy: "no-cache",
          });

          const item = res.data?.unblockNumber?.item;
          if (item) {
            const next = fromServerItem(item, localRow.tags);
            await upsertLocalPhoneInfo({
              phone,
              report_count: next.report_count,
              risk_level: next.risk_level,
              tags: next.tags,
              last_report_at: next.last_report_at,
              updated_at: next.updated_at,
              local_blocked: false,
            });
            return next;
          }
        } catch {
          // local state remains source of truth for immediate UX
        }
      }

      return fromLocalInfo(localRow);
    },
    [isLoggedIn]
  );

  const reportPhone = useCallback(
    async (payload: ReportPayload): Promise<PhoneActionItem> => {
      const phone = normalizePhone(payload.phone);
      if (!phone) throw new Error("Invalid phone");

      const previous = await getLocalPhoneInfo(phone);
      const optimistic = await upsertLocalPhoneInfo({
        phone,
        report_count: (previous?.report_count ?? 0) + 1,
        risk_level: Math.max(previous?.risk_level ?? 0, 10),
        tags: previous?.tags ?? [],
        last_report_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        local_blocked: previous?.local_blocked ?? false,
      });

      try {
        const res = await client.mutate<{ reportPhone: { item: any } }>({
          mutation: M_REPORT_PHONE_ACTION,
          variables: {
            phone,
            category: payload.category ?? "SCAM",
            note: payload.note?.trim() ? payload.note.trim() : null,
          },
          fetchPolicy: "no-cache",
        });

        const item = res.data?.reportPhone?.item;
        if (item) {
          const next = fromServerItem(item, previous?.tags ?? []);
          await upsertLocalPhoneInfo({
            phone,
            report_count: next.report_count,
            risk_level: next.risk_level,
            tags: next.tags,
            last_report_at: next.last_report_at,
            updated_at: next.updated_at,
            local_blocked: next.my_blocked || previous?.local_blocked || false,
          });

          if (payload.appendLog) {
            await appendBlockedLog({
              phone,
              rawPhone: payload.rawPhone ?? phone,
              type: payload.type ?? "call",
              detail: detailJson(payload.source ?? "unknown", "spam_warning", payload.note ?? null),
            });
          }

          return next;
        }
      } catch (error) {
        if (previous) {
          await upsertLocalPhoneInfo(previous);
        }
        throw error;
      }

      return fromLocalInfo(optimistic);
    },
    []
  );

  const logIgnoredPhone = useCallback(async (phoneRaw: string, source: PhoneActionSource, rawPhone?: string | null) => {
    const phone = normalizePhone(phoneRaw);
    if (!phone) return;

    await appendBlockedLog({
      phone,
      rawPhone: rawPhone ?? phone,
      type: "call",
      detail: detailJson(source, "ignored"),
    });
  }, []);

  return {
    normalizePhoneNumber,
    getPhoneInfo,
    blockPhone,
    unblockPhone,
    reportPhone,
    logIgnoredPhone,
  };
}