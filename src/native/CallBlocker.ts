// src/native/CallBlocker.ts
import { NativeEventEmitter, NativeModules } from "react-native";

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
  };
};

export async function ensureCallScreeningRole(): Promise<boolean> {
  const held = await CallScreenRole.isCallScreeningEnabled();
  if (held) return true;
  return await CallScreenRole.requestCallScreeningRole();
}