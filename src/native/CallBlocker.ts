// src/native/CallBlocker.ts
import { NativeModules } from "react-native";

const { CallBlocker } = NativeModules;

export function addBlockedNumber(phone: string): Promise<boolean> {
  return CallBlocker.addBlockedNumber(phone);
}

export function removeBlockedNumber(phone: string): Promise<boolean> {
  return CallBlocker.removeBlockedNumber(phone);
}

export function listBlockedNumbers(): Promise<string[]> {
  return CallBlocker.listBlockedNumbers();
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