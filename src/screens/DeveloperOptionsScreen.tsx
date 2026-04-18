import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  NativeModules,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useNavigation } from "@react-navigation/native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n";
import { useHiddenDiagnosticsMode } from "../lib/hiddenDiagnostics";
import { toastError, toastSuccess } from "../lib/toast";
import {
  collectDeveloperDiagnostics,
  getPermissionSummary,
  uploadDiagnosticsPackage,
  type DeveloperDiagnosticsPackage,
} from "../lib/developerDiagnostics";
import {
  clearCallCheckLogs,
  copyDatabaseForExport,
  debugLookupNumber,
  getCallCheckLogs,
  getNativeBlockDebugData,
  runDbHealthCheck,
  type CallCheckLogItem,
} from "../native/CallBlocker";

type ReleaseDiagnosticsPayload = {
  events?: Array<Record<string, any>>;
};

export default function DeveloperOptionsScreen() {
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { user } = useAuth();
  const hiddenDiag = useHiddenDiagnosticsMode();

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nativeDb, setNativeDb] = useState<Record<string, any> | null>(null);
  const [dbHealth, setDbHealth] = useState<Record<string, any> | null>(null);
  const [permissionSummary, setPermissionSummary] = useState<Record<string, any> | null>(null);
  const [callLogs, setCallLogs] = useState<CallCheckLogItem[]>([]);
  const [releaseEventsCount, setReleaseEventsCount] = useState(0);
  const [diagnosticsJson, setDiagnosticsJson] = useState<string>("{}");
  const [simInput, setSimInput] = useState("");
  const [simResult, setSimResult] = useState<Record<string, any> | null>(null);
  const didNavigateAwayRef = useRef(false);

  const userId = useMemo(() => (user?.id ? String(user.id) : null), [user?.id]);

  const fetchReleaseDiagnostics = useCallback(async (): Promise<ReleaseDiagnosticsPayload | null> => {
    try {
      const payload = await (NativeModules as any)?.CallBlocker?.getReleaseDiagnostics?.();
      return payload || null;
    } catch {
      return null;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [db, health, logs, perms, releasePayload, diagnosticsPkg] = await Promise.all([
        getNativeBlockDebugData(),
        runDbHealthCheck(),
        getCallCheckLogs(200),
        getPermissionSummary(),
        fetchReleaseDiagnostics(),
        collectDeveloperDiagnostics({
          userId,
          developerModeEnabled: hiddenDiag.enabled,
          includeDbDebugText: false,
        }),
      ]);

      setNativeDb(db || null);
      setDbHealth(health || null);
      setCallLogs(Array.isArray(logs) ? logs : []);
      setPermissionSummary(perms || null);
      setReleaseEventsCount(Array.isArray(releasePayload?.events) ? releasePayload!.events!.length : 0);
      setDiagnosticsJson(JSON.stringify(diagnosticsPkg, null, 2));
    } catch (e: any) {
      toastError(e?.message || t("developer.refresh_failed"));
    } finally {
      setLoading(false);
    }
  }, [fetchReleaseDiagnostics, hiddenDiag.enabled, t, userId]);

  useEffect(() => {
    refreshAll().catch(() => {
      // handled in refreshAll
    });
  }, [refreshAll]);

  const renderHeaderRight = useCallback(
    () => (
      <Pressable
        onPress={() => {
          refreshAll().catch(() => {
            // handled in refreshAll
          });
        }}
        accessibilityRole="button"
        accessibilityLabel={t("developer.refresh")}
        disabled={loading}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.headerRefreshButton}
      >
        {loading ? (
          <ActivityIndicator size="small" />
        ) : (
          <Ionicons name="refresh" size={22} color="#4da6ff" />
        )}
      </Pressable>
    ),
    [loading, refreshAll, t]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("developer.title"),
      headerRight: renderHeaderRight,
    });
  }, [navigation, renderHeaderRight, t]);

  const shareText = useCallback(async (title: string, text: string) => {
    await Share.share({
      title,
      message: text,
    });
  }, []);

  const onExportDiagnosticsJson = useCallback(async () => {
    if (!diagnosticsJson || diagnosticsJson === "{}") {
      toastError(t("developer.no_diagnostics"));
      return;
    }
    await shareText(t("developer.export_diagnostics_json"), diagnosticsJson);
  }, [diagnosticsJson, shareText, t]);

  const onExportCallLogs = useCallback(async () => {
    const payload = {
      exported_at: new Date().toISOString(),
      count: callLogs.length,
      logs: callLogs,
    };
    await shareText(t("developer.export_call_logs"), JSON.stringify(payload, null, 2));
  }, [callLogs, shareText, t]);

  const onExportDbCopy = useCallback(async () => {
    try {
      const res = await copyDatabaseForExport();
      await Share.share({
        title: t("developer.export_db_copy"),
        message: `${t("developer.db_export_created_at")} ${res.exportPath}`,
        url: `file://${res.exportPath}`,
      });
    } catch (e: any) {
      toastError(e?.message || t("developer.export_db_copy_failed"));
    }
  }, [t]);

  const onExportFullBundle = useCallback(async () => {
    try {
      const bundle = await collectDeveloperDiagnostics({
        userId,
        developerModeEnabled: hiddenDiag.enabled,
        includeDbDebugText: true,
      });
      await shareText(t("developer.export_full_package"), JSON.stringify(bundle, null, 2));
    } catch (e: any) {
      toastError(e?.message || t("developer.export_full_package_failed"));
    }
  }, [hiddenDiag.enabled, shareText, t, userId]);

  const onUpload = useCallback(async () => {
    setUploading(true);
    try {
      const payload: DeveloperDiagnosticsPackage = await collectDeveloperDiagnostics({
        userId,
        developerModeEnabled: hiddenDiag.enabled,
        includeDbDebugText: true,
      });
      await uploadDiagnosticsPackage(payload);
      toastSuccess(t("developer.upload_success"));
    } catch (e: any) {
      const detail = String(e?.message || "").trim();
      if (__DEV__) {
        toastError(`${t("developer.upload_failed_prefix")} ${detail || t("common.unknown_error")}`);
      } else {
        toastError(t("developer.upload_failed_fallback"));
      }

      console.warn("[DeveloperOptions] upload diagnostics failed", {
        message: detail,
        details: e?.details || null,
      });
    } finally {
      setUploading(false);
    }
  }, [hiddenDiag.enabled, t, userId]);

  const onClearLogs = useCallback(async () => {
    Alert.alert(t("developer.clear_logs_title"), t("developer.clear_logs_message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("developer.clear"),
        style: "destructive",
        onPress: () => {
          (async () => {
            await clearCallCheckLogs().catch(() => null);
            await (NativeModules as any)?.CallBlocker?.clearReleaseDiagnostics?.().catch(() => null);
            toastSuccess(t("developer.debug_logs_cleared"));
            await refreshAll();
          })().catch(() => {
            toastError(t("developer.clear_logs_failed"));
          });
        },
      },
    ]);
  }, [refreshAll, t]);

  const onResetDeveloperMode = useCallback(() => {
    Alert.alert(t("developer.reset_title"), t("developer.reset_message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("developer.disable"),
        style: "destructive",
        onPress: () => {
          (async () => {
            await hiddenDiag.setEnabled(false);
            toastSuccess(t("developer.disabled"));
            if (didNavigateAwayRef.current) return;
            didNavigateAwayRef.current = true;
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate("ScamProtect");
          })().catch(() => {
            toastError(t("developer.disable_failed"));
          });
        },
      },
    ]);
  }, [hiddenDiag, navigation, t]);

  useEffect(() => {
    if (!hiddenDiag.loaded || hiddenDiag.enabled || didNavigateAwayRef.current) return;
    didNavigateAwayRef.current = true;
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("ScamProtect");
  }, [hiddenDiag.enabled, hiddenDiag.loaded, navigation]);

  const onRunHealth = useCallback(async () => {
    try {
      const payload = await runDbHealthCheck();
      setDbHealth(payload || null);
      toastSuccess(t("developer.db_health_completed"));
    } catch (e: any) {
      toastError(e?.message || t("developer.db_health_failed"));
    }
  }, [t]);

  const onTestSimulator = useCallback(async () => {
    if (!simInput.trim()) {
      toastError(t("developer.enter_phone_first"));
      return;
    }
    try {
      const result = await debugLookupNumber(simInput.trim());
      setSimResult(result || null);
      const explanation =
        result?.finalDecision === "BLOCK"
          ? t("developer.sim_result_block")
          : result?.finalDecision === "WARN"
            ? t("developer.sim_result_warn")
            : t("developer.sim_result_allow");
      toastSuccess(explanation);
    } catch (e: any) {
      toastError(e?.message || t("developer.simulator_failed"));
    }
  }, [simInput, t]);

  const copySummary = useCallback(() => {
    const summary = {
      developer_mode_enabled: hiddenDiag.enabled,
      db_health_status: dbHealth?.db_health_status,
      schema_validation_result: dbHealth?.schema_validation_result,
      db_path: nativeDb?.dbPath,
      db_exists: nativeDb?.fileExists,
      db_size: nativeDb?.fileSizeBytes,
      total_rows: nativeDb?.totalCount,
      local_rows: nativeDb?.localCount,
      global_rows: nativeDb?.globalCount,
      call_check_logs_count: callLogs.length,
      release_events_count: releaseEventsCount,
      permission_summary: permissionSummary,
    };
    Clipboard.setString(JSON.stringify(summary, null, 2));
    toastSuccess(t("developer.debug_summary_copied"));
  }, [callLogs.length, dbHealth, hiddenDiag.enabled, nativeDb, permissionSummary, releaseEventsCount, t]);

  return (
    <View style={styles.screen}>
      {!hiddenDiag.enabled ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{t("developer.mode_disabled_hint")}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body}>
        <Section title={t("developer.mode_status_section")}>
          <MonoLine label={t("developer.enabled")} value={String(hiddenDiag.enabled)} />
          <ActionRow label={t("developer.copy_debug_summary")} onPress={copySummary} />
          <ActionRow label={t("developer.reset_mode")} onPress={onResetDeveloperMode} danger />
        </Section>

        <Section title={t("developer.db_diagnostics_section")}>
          <MonoLine label={t("developer.db_name")} value={String(nativeDb?.dbName || "")} />
          <MonoLine label={t("developer.db_path")} value={String(nativeDb?.dbPath || "")} />
          <MonoLine label={t("developer.db_exists")} value={String(nativeDb?.fileExists ?? false)} />
          <MonoLine label={t("developer.db_size_bytes")} value={String(nativeDb?.fileSizeBytes || 0)} />
          <MonoLine label={t("developer.total_rows")} value={String(nativeDb?.totalCount || 0)} />
          <MonoLine label={t("developer.local_blocked_rows")} value={String(nativeDb?.localCount || 0)} />
          <MonoLine label={t("developer.global_rows")} value={String(nativeDb?.globalCount || 0)} />
          <MonoLine label={t("developer.call_log_rows")} value={String(callLogs.length)} />
          <MonoLine label={t("developer.schema_validation")} value={String(dbHealth?.schema_validation_result ?? false)} />
          <MonoLine label={t("developer.db_health_status")} value={String(dbHealth?.db_health_status || t("developer.unknown"))} />
          <ActionRow label={t("developer.rerun_db_health_check")} onPress={onRunHealth} />
          <ActionRow label={t("developer.validate_db_schema")} onPress={onRunHealth} />
        </Section>

        <Section title={t("developer.permission_panel_section")}>
          <MonoLine label={t("developer.read_phone_state")} value={String(permissionSummary?.read_phone_state || t("developer.unknown"))} />
          <MonoLine label={t("developer.read_call_log")} value={String(permissionSummary?.read_call_log || t("developer.unknown"))} />
          <MonoLine label={t("developer.read_contacts")} value={String(permissionSummary?.read_contacts || t("developer.unknown"))} />
          <MonoLine label={t("developer.post_notifications")} value={String(permissionSummary?.post_notifications || t("developer.unknown"))} />
        </Section>

        <Section title={t("developer.call_diagnostics_section")}>
          <MonoLine label={t("developer.last_final_action")} value={String(callLogs[0]?.final_action || "")} />
          <MonoLine label={t("developer.last_reason")} value={String(callLogs[0]?.reason || "")} />
          <MonoLine label={t("developer.last_normalized")} value={String(callLogs[0]?.phone_normalized || "")} />
          <MonoLine label={t("developer.last_lookup_duration_ms")} value={String(callLogs[0]?.lookup_duration_ms || 0)} />
          <MonoLine label={t("developer.release_events")} value={String(releaseEventsCount)} />
        </Section>

        <Section title={t("developer.export_tools_section")}>
          <ActionRow label={t("developer.export_diagnostics_json")} onPress={onExportDiagnosticsJson} />
          <ActionRow label={t("developer.export_call_logs")} onPress={onExportCallLogs} />
          <ActionRow label={t("developer.export_db_copy")} onPress={onExportDbCopy} />
          <ActionRow label={t("developer.export_full_package")} onPress={onExportFullBundle} />
        </Section>

        <Section title={t("developer.server_sync_upload_section")}>
          <ActionRow label={uploading ? t("developer.uploading") : t("developer.upload_diagnostics_logs")} onPress={onUpload} disabled={uploading} />
        </Section>

        <Section title={t("developer.test_number_simulator_section")}>
          <TextInput
            style={styles.input}
            value={simInput}
            onChangeText={setSimInput}
            placeholder={t("developer.enter_phone_number")}
            placeholderTextColor="#64748b"
            keyboardType="phone-pad"
          />
          <ActionRow label={t("developer.run_decision_engine")} onPress={onTestSimulator} />
          {simResult ? <Text style={styles.jsonText}>{JSON.stringify(simResult, null, 2)}</Text> : null}
        </Section>

        <Section title={t("developer.last_20_call_decisions_section")}>
          {callLogs.slice(0, 20).map((item) => (
            <View key={String(item.id)} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.phone_original || item.phone_normalized}</Text>
              <Text style={styles.logMeta}>
                {item.final_action} • {item.reason} • {t("developer.risk_short")}{item.global_risk_level} • {new Date(item.timestamp || 0).toISOString()}
              </Text>
            </View>
          ))}
          {callLogs.length === 0 ? <Text style={styles.empty}>{t("developer.no_call_decision_logs")}</Text> : null}
        </Section>

        <Section title={t("developer.dangerous_tools_section")}>
          <ActionRow label={t("developer.clear_debug_logs")} onPress={onClearLogs} danger />
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MonoLine({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.mono}>
      {label}: {value}
    </Text>
  );
}

function ActionRow({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable style={[styles.actionBtn, danger && styles.actionBtnDanger, disabled && styles.actionBtnDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0f" },
  headerRefreshButton: {
    marginRight: 14,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  warnBox: {
    margin: 12,
    borderWidth: 1,
    borderColor: "#8b5f00",
    backgroundColor: "rgba(245,158,11,0.12)",
    borderRadius: 12,
    padding: 12,
  },
  warnText: { color: "#fde68a", fontWeight: "700" },
  body: { padding: 12, paddingBottom: 24 },
  card: {
    marginBottom: 10,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#121722",
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "900", marginBottom: 8 },
  mono: { color: "#dbe3f2", fontFamily: "Courier", fontSize: 12, marginBottom: 4 },
  actionBtn: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "#1a2230",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  actionBtnDanger: {
    borderColor: "rgba(239,68,68,0.5)",
    backgroundColor: "rgba(127,29,29,0.45)",
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 10,
    color: "#fff",
    backgroundColor: "#0f131c",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  jsonText: {
    marginTop: 8,
    color: "#dbe3f2",
    fontFamily: "Courier",
    fontSize: 12,
    backgroundColor: "#0f131c",
    borderRadius: 8,
    padding: 8,
  },
  logRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  logTitle: { color: "#fff", fontWeight: "800", fontSize: 13 },
  logMeta: { color: "#a7b6d3", fontSize: 12, marginTop: 2 },
  empty: { color: "#94a3b8", fontStyle: "italic" },
});
