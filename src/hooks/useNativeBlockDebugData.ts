import { useCallback, useState } from "react";
import { NativeModules } from "react-native";

export type NativeBlockDebugItem = {
  phone: string;
  rawPhone?: string;
  riskLevel: number;
  localBlocked: boolean;
  serverDeleted: number;
  reportCount?: number;
  lastReportAt?: string;
  tags?: string;
};

export type NativeBlockDebugData = {
  dbName: string;
  dbPath: string;
  totalCount: number;
  localCount: number;
  globalCount: number;
  local: NativeBlockDebugItem[];
  global: NativeBlockDebugItem[];
};

type State = {
  data: NativeBlockDebugData;
  loading: boolean;
  error: string | null;
};

const EMPTY: NativeBlockDebugData = {
  dbName: "scam-protect.db",
  dbPath: "",
  totalCount: 0,
  localCount: 0,
  globalCount: 0,
  local: [],
  global: [],
};

export function useNativeBlockDebugData() {
  const [state, setState] = useState<State>({ data: EMPTY, loading: false, error: null });

  const fetchData = useCallback(async () => {
    if (!__DEV__) return;

    const mod = (NativeModules as any)?.CallBlocker;
    if (!mod?.getNativeBlockDebugData) {
      setState({ data: EMPTY, loading: false, error: "Native method CallBlocker.getNativeBlockDebugData not available" });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res: NativeBlockDebugData | any = await mod.getNativeBlockDebugData();
      const data: NativeBlockDebugData = {
        dbName: typeof res?.dbName === "string" ? res.dbName : "scam-protect.db",
        dbPath: typeof res?.dbPath === "string" ? res.dbPath : "",
        totalCount: typeof res?.totalCount === "number" ? res.totalCount : 0,
        localCount: typeof res?.localCount === "number" ? res.localCount : 0,
        globalCount: typeof res?.globalCount === "number" ? res.globalCount : 0,
        local: Array.isArray(res?.local) ? res.local : [],
        global: Array.isArray(res?.global) ? res.global : [],
      };

      setState({ data, loading: false, error: null });
    } catch (e: any) {
      setState({ data: EMPTY, loading: false, error: e?.message || String(e) });
    }
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    fetchData,
  };
}
