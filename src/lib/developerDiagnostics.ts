import { gql } from "@apollo/client";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { client } from "../apollo/client";
import { ENV } from "../config/env";
import { loadDeviceInfo } from "../device/deviceInfo";
import {
  exportDbDebug,
  getAppInstallDiagnostics,
  getCallCheckLogs,
  getCallScreeningStatus,
  getCallScreeningSummary,
  getNativeBlockDebugData,
  runDbHealthCheck,
  type CallCheckLogItem,
} from "../native/CallBlocker";

const M_UPLOAD_DIAGNOSTICS = gql`
  mutation UploadDiagnostics($input: UploadDiagnosticsInput!) {
    uploadDiagnostics(input: $input) {
      success
      uploadId
      message
    }
  }
`;

export type PermissionSummary = {
  read_phone_state: "granted" | "denied" | "unavailable";
  read_call_log: "granted" | "denied" | "unavailable";
  read_contacts: "granted" | "denied" | "unavailable";
  post_notifications: "granted" | "denied" | "unavailable";
};

export async function getPermissionSummary(): Promise<PermissionSummary> {
  if (Platform.OS !== "android") {
    return {
      read_phone_state: "unavailable",
      read_call_log: "unavailable",
      read_contacts: "unavailable",
      post_notifications: "unavailable",
    };
  }

  const check = async (perm: string): Promise<"granted" | "denied"> => {
    try {
      const ok = await PermissionsAndroid.check(perm as any);
      return ok ? "granted" : "denied";
    } catch {
      return "denied";
    }
  };

  return {
    read_phone_state: await check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE),
    read_call_log: await check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
    read_contacts: await check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS),
    post_notifications:
      Platform.Version >= 33
        ? await check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
        : "granted",
  };
}

export type DeveloperDiagnosticsPackage = {
  exported_at: string;
  user_id?: string | null;
  app: {
    version: string;
    build: string;
    platform: string;
    package_name?: string;
    application_id?: string;
  };
  device: Record<string, any>;
  permission_summary: PermissionSummary;
  developer_mode_enabled: boolean;
  db_info: Record<string, any>;
  db_health: Record<string, any>;
  call_screening_status: Record<string, any>;
  call_screening_summary: Record<string, any>;
  app_install_diagnostics: Record<string, any>;
  recent_call_check_logs: CallCheckLogItem[];
  release_diagnostics_events: any[];
  ai_debug_metadata: Record<string, any>;
  db_debug_text?: string;
};

export async function collectDeveloperDiagnostics(input: {
  userId?: string | null;
  developerModeEnabled: boolean;
  includeDbDebugText?: boolean;
}): Promise<DeveloperDiagnosticsPackage> {
  const [
    deviceInfo,
    permissionSummary,
    nativeDb,
    dbHealth,
    callStatus,
    callSummary,
    appInstall,
    callCheckLogs,
  ] = await Promise.all([
    loadDeviceInfo(),
    getPermissionSummary(),
    getNativeBlockDebugData(),
    runDbHealthCheck(),
    getCallScreeningStatus(),
    getCallScreeningSummary(),
    getAppInstallDiagnostics(),
    getCallCheckLogs(200),
  ]);

  const dbDebugText = input.includeDbDebugText ? await exportDbDebug().catch(() => "") : "";
  const nativeDbAny = (nativeDb || {}) as any;
  const dbHealthAny = (dbHealth || {}) as any;
  const callStatusAny = (callStatus || {}) as any;
  const callSummaryAny = (callSummary || {}) as any;
  const appInstallAny = (appInstall || {}) as any;

  const releaseDiagnosticsEvents = await (async () => {
    try {
      const payload = await (NativeModules as any)?.CallBlocker?.getReleaseDiagnostics?.();
      return Array.isArray(payload?.events) ? payload.events : [];
    } catch {
      return [];
    }
  })();

  const readPath = String(nativeDbAny?.dbPath || "").trim();
  const writePath = String(nativeDbAny?.writeDbPath || nativeDbAny?.lastWriteDbPath || "").trim();
  const readWriteMatch = !!readPath && !!writePath && readPath === writePath;

  return {
    exported_at: new Date().toISOString(),
    user_id: input.userId ?? null,
    app: {
      version: String(deviceInfo?.appVersion || ""),
      build: String(deviceInfo?.buildNumber || ""),
      platform: String(deviceInfo?.platform || Platform.OS),
      package_name: String(nativeDbAny?.packageName || appInstallAny?.packageName || ""),
      application_id: String(appInstallAny?.applicationId || ""),
    },
    device: {
      ...deviceInfo,
      android_version: String(deviceInfo?.systemVersion || ""),
      manufacturer: String(callStatusAny?.manufacturer || ""),
      model: String(callStatusAny?.model || ""),
      is_emulator: !!(deviceInfo?.isEmulator || callStatusAny?.isEmulator),
    },
    permission_summary: permissionSummary,
    developer_mode_enabled: !!input.developerModeEnabled,
    db_info: nativeDb,
    db_health: dbHealthAny,
    call_screening_status: callStatusAny,
    call_screening_summary: callSummaryAny,
    app_install_diagnostics: appInstallAny,
    recent_call_check_logs: callCheckLogs,
    release_diagnostics_events: releaseDiagnosticsEvents,
    ai_debug_metadata: {
      decision_explanation: callCheckLogs[0]?.decision_explanation || "",
      schema_validation_result: !!dbHealthAny?.schema_validation_result,
      db_health_status: String(dbHealthAny?.db_health_status || "unknown"),
      normalization_variants_checked: callCheckLogs[0]?.normalization_variants_checked || "[]",
      lookup_duration_ms: Number(callCheckLogs[0]?.lookup_duration_ms || 0),
      transaction_commit_status: !!nativeDbAny?.transactionCommitted,
      read_path_vs_write_path_match: readWriteMatch,
      package_name: String(nativeDbAny?.packageName || appInstallAny?.packageName || ""),
      application_id: String(appInstallAny?.applicationId || ""),
      call_screening_service_status: String(callSummaryAny?.lastDecision || callStatusAny?.state || "unknown"),
    },
    db_debug_text: dbDebugText || undefined,
  };
}

export async function uploadDiagnosticsPackage(payload: DeveloperDiagnosticsPackage) {
  const input = {
    userId: payload.user_id || null,
    platform: payload.app.platform || Platform.OS,
    appVersion: payload.app.version || "",
    buildNumber: payload.app.build || "",
    packageName: payload.app.package_name || "",
    deviceModel: String((payload.device as any)?.deviceName || (payload.device as any)?.model || ""),
    osVersion: String((payload.device as any)?.android_version || (payload.device as any)?.systemVersion || ""),
    exportedAt: payload.exported_at,
    diagnosticsJson: JSON.stringify(payload),
    callCheckLogsJson: JSON.stringify(payload.recent_call_check_logs || []),
  };

  const endpoint = `${ENV.apiBase}/api/graphql`;
  console.info("[DeveloperDiagnostics] mutation=UploadDiagnostics endpoint=", endpoint);
  console.info("[DeveloperDiagnostics] inputKeys=", Object.keys(input));

  try {
    const diagnosticsResult = await client.mutate({
      mutation: M_UPLOAD_DIAGNOSTICS,
      variables: { input },
      fetchPolicy: "no-cache",
    });

    return {
      diagnosticsResult: diagnosticsResult?.data,
    };
  } catch (error: any) {
    const gqlErrors = Array.isArray(error?.graphQLErrors)
      ? error.graphQLErrors.map((e: any) => e?.message).filter(Boolean)
      : [];
    const networkMessage = error?.networkError?.message || "";
    const topMessage = error?.message || "Upload diagnostics failed";
    const combined = [topMessage, ...gqlErrors, networkMessage].filter(Boolean).join(" | ");

    console.warn("[DeveloperDiagnostics] uploadDiagnostics failed", {
      endpoint,
      mutation: "UploadDiagnostics",
      inputKeys: Object.keys(input),
      errors: gqlErrors,
      networkError: networkMessage,
      message: topMessage,
    });

    const err = new Error(combined || "Upload diagnostics failed");
    (err as any).details = {
      endpoint,
      mutation: "UploadDiagnostics",
      gqlErrors,
      networkMessage,
    };
    throw err;
  }
}
