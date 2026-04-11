import { useCallback, useRef, useState } from "react";
import { NativeModules } from "react-native";
import { normalizeTel } from "../lib/jachoeiLocalState";

export type NativeBlockDebugItem = {
  phone: string;
  rawPhone?: string;
  id?: number;
  riskLevel: number;
  localBlocked: boolean;
  localBlockedRaw?: number;
  serverDeleted: number;
  reportCount?: number;
  lastReportAt?: string;
  tags?: string;
  createdAt?: string;
  updatedAt?: string;
  serverUpdatedAt?: string;
};

export type NativeBlockDebugData = {
  dbName: string;
  dbPath: string;
  dbDir?: string;
  packageName?: string;
  fileExists?: boolean;
  fileSizeBytes?: number;
  pragmaMainPath?: string;
  tableUsed?: string;
  tables?: string[];
  tableCounts?: Record<string, number>;
  schemaInfo?: Record<string, string[]>;
  debugError?: string;
  debugWarnings?: string[];
  rawCountBeforeFilter?: number;
  rawTableCount?: number;
  appliedQueries?: Record<string, string>;
  appliedFilters?: Record<string, string>;
  sampleRows?: NativeBlockDebugItem[];
  localRowsPreview?: NativeBlockDebugItem[];
  globalRowsPreview?: NativeBlockDebugItem[];

  rawRows?: NativeBlockDebugItem[];

  // deep write proof
  writeDbName?: string;
  writeDbPath?: string;
  writeTableName?: string;
  writeSql?: string;
  writeArgs?: string;
  transactionCommitted?: boolean;
  insertResultRowId?: number;
  rowsAffected?: number;
  countFromWriteTableAfterWrite?: number;
  sampleRowsFromWriteTableAfterWrite?: string;

  phone_normalized?: string;
  didInsert?: boolean;
  didUpdate?: boolean;
  matchedRowAfterWrite?: string;
  lastWriteTs?: number;
  lastWriteAction?: string;
  lastWriteDbPath?: string;
  lastWriteRowsAffected?: number;
  lastWriteError?: string;
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
  dbDir: "",
  packageName: "",
  fileExists: false,
  fileSizeBytes: 0,
  pragmaMainPath: "",
  tableUsed: "",
  tables: [],
  tableCounts: {},
  schemaInfo: {},
  debugError: "",
  debugWarnings: [],
  rawCountBeforeFilter: 0,
  rawTableCount: 0,
  appliedQueries: {},
  appliedFilters: {},
  sampleRows: [],
  localRowsPreview: [],
  globalRowsPreview: [],

  rawRows: [],

  writeDbName: "",
  writeDbPath: "",
  writeTableName: "",
  writeSql: "",
  writeArgs: "",
  transactionCommitted: false,
  insertResultRowId: 0,
  rowsAffected: 0,
  countFromWriteTableAfterWrite: 0,
  sampleRowsFromWriteTableAfterWrite: "",

  phone_normalized: "",
  didInsert: false,
  didUpdate: false,
  matchedRowAfterWrite: "",
  lastWriteTs: 0,
  lastWriteAction: "",
  lastWriteDbPath: "",
  lastWriteRowsAffected: 0,
  lastWriteError: "",
  totalCount: 0,
  localCount: 0,
  globalCount: 0,
  local: [],
  global: [],
};

function getPhoneKey(phone: string | undefined): string {
  const normalized = normalizeTel(String(phone || ""));
  return normalized || String(phone || "").trim();
}

function matchesPhone(itemPhone: string | undefined, targetPhone: string): boolean {
  const itemKey = getPhoneKey(itemPhone);
  if (!itemKey) return false;
  return itemKey === getPhoneKey(targetPhone);
}

function sortRows(rows: NativeBlockDebugItem[]): NativeBlockDebugItem[] {
  return [...rows].sort((left, right) => {
    const riskDiff = Number(right.riskLevel || 0) - Number(left.riskLevel || 0);
    if (riskDiff !== 0) return riskDiff;

    const leftPhone = String(left.phone || "");
    const rightPhone = String(right.phone || "");
    return leftPhone.localeCompare(rightPhone);
  });
}

function toOptimisticGlobalRow(item: NativeBlockDebugItem): NativeBlockDebugItem {
  return {
    ...item,
    localBlocked: false,
    localBlockedRaw: -1,
  };
}

export function useNativeBlockDebugData() {
  const [state, setState] = useState<State>({ data: EMPTY, loading: false, error: null });
  const inflightRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (inflightRef.current) return;

    const mod = (NativeModules as any)?.CallBlocker;
    if (!mod?.getNativeBlockDebugData) {
      setState({ data: EMPTY, loading: false, error: "Native method CallBlocker.getNativeBlockDebugData not available" });
      return;
    }

    inflightRef.current = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res: NativeBlockDebugData | any = await mod.getNativeBlockDebugData();
      const data: NativeBlockDebugData = {
        dbName: typeof res?.dbName === "string" ? res.dbName : "scam-protect.db",
        dbPath: typeof res?.dbPath === "string" ? res.dbPath : "",
        dbDir: typeof res?.dbDir === "string" ? res.dbDir : "",
        packageName: typeof res?.packageName === "string" ? res.packageName : "",
        fileExists: typeof res?.fileExists === "boolean" ? res.fileExists : false,
        fileSizeBytes: typeof res?.fileSizeBytes === "number" ? res.fileSizeBytes : 0,
        pragmaMainPath: typeof res?.pragmaMainPath === "string" ? res.pragmaMainPath : "",
        tableUsed: typeof res?.tableUsed === "string" ? res.tableUsed : "",
        tables: Array.isArray(res?.tables) ? res.tables : [],
        tableCounts: res?.tableCounts && typeof res.tableCounts === "object" ? res.tableCounts : {},
        schemaInfo: res?.schemaInfo && typeof res.schemaInfo === "object" ? res.schemaInfo : {},
        debugError: typeof res?.debugError === "string" ? res.debugError : "",
        debugWarnings: Array.isArray(res?.debugWarnings) ? res.debugWarnings : [],
        rawCountBeforeFilter: typeof res?.rawCountBeforeFilter === "number" ? res.rawCountBeforeFilter : 0,
        rawTableCount: typeof res?.rawTableCount === "number" ? res.rawTableCount : 0,
        appliedQueries: res?.appliedQueries && typeof res.appliedQueries === "object" ? res.appliedQueries : {},
        appliedFilters: res?.appliedFilters && typeof res.appliedFilters === "object" ? res.appliedFilters : {},
        sampleRows: Array.isArray(res?.sampleRows) ? res.sampleRows : [],
        localRowsPreview: Array.isArray(res?.localRowsPreview) ? res.localRowsPreview : [],
        globalRowsPreview: Array.isArray(res?.globalRowsPreview) ? res.globalRowsPreview : [],
        rawRows: Array.isArray(res?.rawRows) ? res.rawRows : [],

        writeDbName: typeof res?.writeDbName === "string" ? res.writeDbName : "",
        writeDbPath: typeof res?.writeDbPath === "string" ? res.writeDbPath : "",
        writeTableName: typeof res?.writeTableName === "string" ? res.writeTableName : "",
        writeSql: typeof res?.writeSql === "string" ? res.writeSql : "",
        writeArgs: typeof res?.writeArgs === "string" ? res.writeArgs : "",
        transactionCommitted: typeof res?.transactionCommitted === "boolean" ? res.transactionCommitted : false,
        insertResultRowId: typeof res?.insertResultRowId === "number" ? res.insertResultRowId : 0,
        rowsAffected: typeof res?.rowsAffected === "number" ? res.rowsAffected : 0,
        countFromWriteTableAfterWrite:
          typeof res?.countFromWriteTableAfterWrite === "number" ? res.countFromWriteTableAfterWrite : 0,
        sampleRowsFromWriteTableAfterWrite:
          typeof res?.sampleRowsFromWriteTableAfterWrite === "string" ? res.sampleRowsFromWriteTableAfterWrite : "",

        phone_normalized: typeof res?.phone_normalized === "string" ? res.phone_normalized : "",
        didInsert: typeof res?.didInsert === "boolean" ? res.didInsert : false,
        didUpdate: typeof res?.didUpdate === "boolean" ? res.didUpdate : false,
        matchedRowAfterWrite: typeof res?.matchedRowAfterWrite === "string" ? res.matchedRowAfterWrite : "",
        lastWriteTs: typeof res?.lastWriteTs === "number" ? res.lastWriteTs : 0,
        lastWriteAction: typeof res?.lastWriteAction === "string" ? res.lastWriteAction : "",
        lastWriteDbPath: typeof res?.lastWriteDbPath === "string" ? res.lastWriteDbPath : "",
        lastWriteRowsAffected: typeof res?.lastWriteRowsAffected === "number" ? res.lastWriteRowsAffected : 0,
        lastWriteError: typeof res?.lastWriteError === "string" ? res.lastWriteError : "",
        totalCount: typeof res?.totalCount === "number" ? res.totalCount : 0,
        localCount: typeof res?.localCount === "number" ? res.localCount : 0,
        globalCount: typeof res?.globalCount === "number" ? res.globalCount : 0,
        local: Array.isArray(res?.local) ? res.local : [],
        global: Array.isArray(res?.global) ? res.global : [],
      };

      setState({ data, loading: false, error: null });
    } catch (e: any) {
      setState({ data: EMPTY, loading: false, error: e?.message || String(e) });
    } finally {
      inflightRef.current = false;
    }
  }, []);

  const applyOptimisticUnblock = useCallback((phone: string) => {
    const targetKey = getPhoneKey(phone);
    if (!targetKey) return;

    setState((prev) => {
      const previousData = prev.data;

      let localRemoved = 0;
      let globalAdded = 0;

      let globalPromotion: NativeBlockDebugItem | null = null;
      const nextLocal = previousData.local.filter((item) => {
        if (!matchesPhone(item.phone, targetKey)) return true;
        localRemoved += 1;
        if (item.serverDeleted !== 1 && globalPromotion == null) {
          globalPromotion = toOptimisticGlobalRow(item);
        }
        return false;
      });

      let sawGlobalMatch = false;
      const nextGlobalMapped = previousData.global.map((item) => {
        if (!matchesPhone(item.phone, targetKey)) return item;
        sawGlobalMatch = true;
        return toOptimisticGlobalRow(item);
      });

      let nextGlobal = nextGlobalMapped;
      if (!sawGlobalMatch && globalPromotion) {
        nextGlobal = sortRows([...nextGlobalMapped, globalPromotion]);
        globalAdded = 1;
      }

      const nextRawRows = (previousData.rawRows || []).map((item) => {
        if (!matchesPhone(item.phone, targetKey)) return item;
        return toOptimisticGlobalRow(item);
      });

      const nextLocalPreview = (previousData.localRowsPreview || []).filter((item) => !matchesPhone(item.phone, targetKey));

      let sawGlobalPreviewMatch = false;
      const nextGlobalPreviewMapped = (previousData.globalRowsPreview || []).map((item) => {
        if (!matchesPhone(item.phone, targetKey)) return item;
        sawGlobalPreviewMatch = true;
        return toOptimisticGlobalRow(item);
      });

      let nextGlobalPreview = nextGlobalPreviewMapped;
      if (!sawGlobalPreviewMatch && globalPromotion) {
        nextGlobalPreview = sortRows([...nextGlobalPreviewMapped, globalPromotion]).slice(0, 10);
      }

      const nextLocalCount = Math.max(0, Number(previousData.localCount || 0) - localRemoved);
      const nextGlobalCount = Math.max(0, Number(previousData.globalCount || 0) + globalAdded);

      return {
        ...prev,
        data: {
          ...previousData,
          localCount: nextLocalCount,
          globalCount: nextGlobalCount,
          totalCount: nextLocalCount + nextGlobalCount,
          local: nextLocal,
          global: nextGlobal,
          rawRows: nextRawRows,
          localRowsPreview: nextLocalPreview,
          globalRowsPreview: nextGlobalPreview,
        },
      };
    });
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    fetchData,
    applyOptimisticUnblock,
  };
}
