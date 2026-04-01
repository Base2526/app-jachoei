import { useCallback, useMemo, useState } from "react";
import { NativeModules } from "react-native";

export type NativeBlockedListItem = {
  phone: string;
  riskLevel: number;
  localBlocked: boolean;
  serverDeleted: number;
};

type NativeBlockedListResponse = {
  dbPath: string;
  dbName?: string;
  table?: string;
  total: number;
  rows: NativeBlockedListItem[];
};

type State = {
  rows: NativeBlockedListItem[];
  dbPath: string;
  total: number;
  loading: boolean;
  error: string | null;
};

export function useNativeBlockedList() {
  const [state, setState] = useState<State>({ rows: [], dbPath: "", total: 0, loading: false, error: null });

  const fetchData = useCallback(async () => {
    if (!__DEV__) return;

    const mod = (NativeModules as any)?.CallBlocker;
    if (!mod?.getNativeBlockedList) {
      setState({ rows: [], dbPath: "", total: 0, loading: false, error: "Native method CallBlocker.getNativeBlockedList not available" });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res: NativeBlockedListResponse | any = await mod.getNativeBlockedList();
      const rows = Array.isArray(res?.rows) ? (res.rows as NativeBlockedListItem[]) : [];
      const dbPath = typeof res?.dbPath === "string" ? String(res.dbPath) : "";
      const total = typeof res?.total === "number" ? Number(res.total) : rows.length;
      setState({ rows, dbPath, total, loading: false, error: null });
    } catch (e: any) {
      setState({ rows: [], dbPath: "", total: 0, loading: false, error: e?.message || String(e) });
    }
  }, []);

  return {
    rows: state.rows,
    loading: state.loading,
    error: state.error,
    dbPath: state.dbPath,
    total: state.total,
    fetchData,
  };
}
