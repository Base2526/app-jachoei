// src/native/SmsRole.ts
import { NativeModules } from "react-native";

const { SmsRole } = NativeModules as {
  SmsRole: {
    isDefaultSmsApp(): Promise<boolean>;
    requestDefaultSmsRole(): Promise<boolean>;
  };
};

export async function ensureDefaultSmsApp(): Promise<boolean> {
  const isDefault = await SmsRole.isDefaultSmsApp();
  if (isDefault) return true;
  return await SmsRole.requestDefaultSmsRole();
}
