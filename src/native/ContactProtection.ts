import { NativeModules, Platform } from "react-native";

type ContactProtectionNativeModule = {
  inspectPhone(phone: string): Promise<ContactInspectResult>;
  markContactAsSpam(phone: string): Promise<ContactInspectResult>;
  unmarkContactAsSpam(phone: string): Promise<ContactInspectResult>;
};

const nativeModule: ContactProtectionNativeModule | null =
  Platform.OS === "android" ? (NativeModules.ContactProtection as ContactProtectionNativeModule | undefined) ?? null : null;

export type ContactInspectResult = {
  permissionGranted: boolean;
  writePermissionGranted?: boolean;
  found: boolean;
  contactId?: string;
  displayName?: string;
  note?: string | null;
  spamMarked: boolean;
  matchedNumber?: string | null;
  matchedVariant?: string | null;
  applied?: boolean;
  appliedTarget?: string | null;
  error?: string;
};

const emptyResult: ContactInspectResult = {
  permissionGranted: false,
  writePermissionGranted: false,
  found: false,
  spamMarked: false,
};

export async function inspectContactPhone(phone: string): Promise<ContactInspectResult> {
  if (!nativeModule) return emptyResult;
  return nativeModule.inspectPhone(String(phone || ""));
}

export async function markContactAsSpam(phone: string): Promise<ContactInspectResult> {
  if (!nativeModule) return emptyResult;
  return nativeModule.markContactAsSpam(String(phone || ""));
}

export async function unmarkContactAsSpam(phone: string): Promise<ContactInspectResult> {
  if (!nativeModule) return emptyResult;
  return nativeModule.unmarkContactAsSpam(String(phone || ""));
}