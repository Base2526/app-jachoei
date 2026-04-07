// src/native/CallBlocker.ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const { CallBlocker } = NativeModules;

const emitter = CallBlocker ? new NativeEventEmitter(CallBlocker) : null;

export function addIncomingSpamCallListener(
  cb: (payload: { phone_normalized: string; risk: number; raw_phone?: string | null }) => void
) {
  return emitter?.addListener("onIncomingSpamCall", cb);
}

export function addBlockedNumber(phone: string): Promise<boolean> {
  return CallBlocker.addBlockedNumber(phone);
}

export function removeBlockedNumber(phone: string): Promise<boolean> {
  return CallBlocker.removeBlockedNumber(phone);
}

export function listBlockedNumbers(): Promise<string[]> {
  return CallBlocker.listBlockedNumbers();
}

export type NativeBlockedListItem = {
  phone: string;
  riskLevel: number;
  localBlocked: boolean;
  serverDeleted: number;
};

export type NativeBlockedListResponse = {
  dbPath: string;
  dbName?: string;
  table?: string;
  total: number;
  rows: NativeBlockedListItem[];
};

export function getNativeBlockedList(): Promise<NativeBlockedListResponse> {
  return CallBlocker.getNativeBlockedList();
}

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

export function getNativeBlockDebugData(): Promise<NativeBlockDebugData> {
  return CallBlocker.getNativeBlockDebugData();
}

export type DbInspectorTableWithCount = {
  name: string;
  count: number;
  error?: string;
};

export type DbInspectorSchemaColumn = {
  name?: string;
  type?: string;
  pk?: number;
  notnull?: number;
};

export type DbInspectorPayload = {
  dbName: string;
  dbPath: string;
  tablesWithCounts: DbInspectorTableWithCount[];
  selectedTable: string;
  selectedTableSchema: DbInspectorSchemaColumn[];
  selectedTableRows: Record<string, any>[];
  error?: string;
};

export function inspectDb(tableName?: string | null): Promise<DbInspectorPayload> {
  return CallBlocker.inspectDb(tableName ?? null);
}

export type NativeLookupDebugResult = {
  dbName?: string;
  dbPath?: string;
  table?: string;
  raw?: string;
  digitsOnly?: string;
  canonical?: string;
  variants?: string[];
  rowsFound?: number;
  matchedRow?: Record<string, any>;
  decision?: "BLOCK" | "ALLOW";
  reason?: string;
  lookupDurationMs?: number;
  error?: string;
};

// Debug-only: run the exact same normalization + DB lookup as CallScreeningService.
export function debugLookupNumber(phone: string): Promise<NativeLookupDebugResult> {
  if (Platform.OS !== "android") {
    return Promise.reject(new Error("debugLookupNumber is Android-only"));
  }
  return CallBlocker.debugLookupNumber(String(phone || ""));
}

// Debug-only: returns a single large JSON text payload with full SQLite state.
export function exportDbDebug(): Promise<string> {
  return CallBlocker.exportDbDebug();
}

export function setHiddenDiagnosticsEnabled(enabled: boolean): Promise<boolean> {
  return CallBlocker.setHiddenDiagnosticsEnabled(!!enabled);
}

export function isHiddenDiagnosticsEnabled(): Promise<boolean> {
  return CallBlocker.isHiddenDiagnosticsEnabled();
}

export type UnblockNativeNumberResult = {
  ok: boolean;
  dbName?: string;
  dbPath?: string;
  phone?: string;
  canonical?: string;
  updated?: number;
  matched?: string[];
  error?: string;
};

export function unblockNativeNumber(phone: string): Promise<UnblockNativeNumberResult> {
  return CallBlocker.unblockNativeNumber(String(phone || ""));
}

export type IncomingCallEvent = {
  id: number;
  phone_normalized: string;
  raw_phone: string | null;
  type: "call" | "sms";
  created_at: string;
  detail: string | null;
};

export function getIncomingCallEvents(sinceId = 0, limit = 200): Promise<IncomingCallEvent[]> {
  return CallBlocker.getIncomingCallEvents(sinceId, limit);
}

export function syncBlockedNumbers(numbers: string[]): Promise<boolean> {
  return CallBlocker.syncBlockedNumbers(numbers);
}

export type SpamNumberItem = {
  phone: string;
  risk_level?: number;
  server_deleted?: number;
  updated_at?: string;
};

export function syncSpamNumbers(items: SpamNumberItem[]): Promise<boolean> {
  return CallBlocker.syncSpamNumbers(items);
}

const { CallScreenRole } = NativeModules as {
  CallScreenRole: {
    isCallScreeningEnabled(): Promise<boolean>;
    requestCallScreeningRole(): Promise<boolean>;
    getCallScreeningStatus(): Promise<{
      sdk: number;
      packageName: string;
      supported: boolean;
      enabled: boolean;
      state?: "ENABLED" | "NOT_ENABLED" | "UNSUPPORTED" | "UNKNOWN";
      reason: string;
      roleHeld?: boolean;
      telecomDefaultPkg?: string;
      manufacturer?: string;
      model?: string;
      isEmulator?: boolean;
    }>;
    openCallerIdAndSpamSettings(): Promise<boolean>;
    getAppInstallDiagnostics(): Promise<{
      packageName: string;
      applicationId: string;
      buildType: string;
      debug: boolean;
      versionCode: number;
      versionName: string;
      installer?: string;
      signingCertSha256?: string;
    }>;
    getCallScreeningSummary(): Promise<{
      lastServiceCreateAt?: number;
      lastServiceBindAt?: number;
      lastScreenAt?: number;
      lastDecision?: string;
      lastRaw?: string;
      lastCanonical?: string;
      lastError?: string;
    }>;
    getLastCallScreeningEvent(): Promise<{
      found: boolean;
      ts?: number;
      msg?: string;
      data?: Record<string, any>;
    }>;
  };
};

export async function ensureCallScreeningRole(): Promise<boolean> {
  const held = await CallScreenRole.isCallScreeningEnabled();
  if (held) return true;
  return await CallScreenRole.requestCallScreeningRole();
}

export function getCallScreeningStatus() {
  return CallScreenRole.getCallScreeningStatus();
}

export function openCallerIdAndSpamSettings() {
  return CallScreenRole.openCallerIdAndSpamSettings();
}

export function getLastCallScreeningEvent() {
  return CallScreenRole.getLastCallScreeningEvent();
}

export function getCallScreeningSummary() {
  return CallScreenRole.getCallScreeningSummary();
}

export function getAppInstallDiagnostics() {
  return CallScreenRole.getAppInstallDiagnostics();
}