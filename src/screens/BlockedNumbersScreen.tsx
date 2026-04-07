// src/screens/BlockedNumbersScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Platform,
  AppState,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  addBlockedNumber,
  removeBlockedNumber,
  listBlockedNumbers,
  getCallScreeningStatus,
  getCallScreeningSummary,
  getLastCallScreeningEvent,
  getAppInstallDiagnostics,
} from "../native/CallBlocker";
import {
  promptCallScreeningIfNeededWithOptions,
} from "../utils/callScreening";

export const BlockedNumbersScreen: React.FC = () => {
  const [phoneInput, setPhoneInput] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [screeningEnabled, setScreeningEnabled] = useState<boolean | null>(null);
  const [screeningReason, setScreeningReason] = useState<string | null>(null);
  const [lastScreenText, setLastScreenText] = useState<string | null>(null);
  const [roleState, setRoleState] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [installText, setInstallText] = useState<string | null>(null);

  const refreshCallScreeningStatus = async () => {
    if (Platform.OS !== "android") return;
    try {
      const st = await getCallScreeningStatus();
      setScreeningEnabled(!!st.enabled);
      setScreeningReason(st.reason || null);
      setRoleState((st as any).state || null);
    } catch (e) {
      setScreeningEnabled(false);
      setScreeningReason("STATUS_ERROR");
      setRoleState(null);
    }

    try {
      const s = await getCallScreeningSummary();
      const pieces: string[] = [];
      if (s.lastServiceCreateAt) pieces.push(`serviceCreateAt=${new Date(s.lastServiceCreateAt).toLocaleString()}`);
      if (s.lastServiceBindAt) pieces.push(`serviceBindAt=${new Date(s.lastServiceBindAt).toLocaleString()}`);
      if (s.lastScreenAt) pieces.push(`lastScreenAt=${new Date(s.lastScreenAt).toLocaleString()}`);
      if (s.lastDecision) pieces.push(`decision=${String(s.lastDecision)}`);
      if (s.lastCanonical) pieces.push(`canonical=${String(s.lastCanonical)}`);
      setSummaryText(pieces.length ? pieces.join("\n") : "No service/screening diagnostics yet");
    } catch (_e) {
      // ignore
    }

    try {
      const last = await getLastCallScreeningEvent();
      if (!last?.found) {
        setLastScreenText("No screening events yet");
      } else {
        const decision = String(last.data?.decision || "").toUpperCase();
        const canonical = String(last.data?.canonical || "");
        const raw = String(last.data?.raw || "");
        setLastScreenText(
          [decision && `decision=${decision}`, canonical && `canonical=${canonical}`, raw && `raw=${raw}`]
            .filter(Boolean)
            .join(" ")
        );
      }
    } catch (_e) {
      // best-effort only
    }

    try {
      const d = await getAppInstallDiagnostics();
      const parts: string[] = [];
      parts.push(`buildType=${d.buildType} debug=${d.debug}`);
      parts.push(`version=${d.versionName} (${d.versionCode})`);
      if (d.installer) parts.push(`installer=${d.installer}`);
      if (d.signingCertSha256) parts.push(`certSha256=${String(d.signingCertSha256).slice(0, 16)}…`);
      setInstallText(parts.join("\n"));
    } catch (_e) {
      // ignore
    }
  };

  const loadNumbers = async () => {
    try {
      setLoading(true);
      const list = await listBlockedNumbers();

      console.log("[BlockedNumbers] list: ", list);
      setNumbers(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("[BlockedNumbers] load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNumbers();
    refreshCallScreeningStatus();
  }, []);

  // Re-check when screen gains focus (returning from Settings, etc.)
  useFocusEffect(
    React.useCallback(() => {
      refreshCallScreeningStatus();
    }, [])
  );

  // Re-check when app returns to foreground.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        refreshCallScreeningStatus();
      }
    });
    return () => sub.remove();
  }, []);

  const handleAdd = async () => {
    const trimmed = phoneInput.trim();
    if (!trimmed) return;

    // Critical requirement: never silently fail if call screening isn't enabled.
    if (Platform.OS === "android") {
      try {
        const st = await getCallScreeningStatus();
        setScreeningEnabled(!!st.enabled);
        setScreeningReason(st.reason || null);
        if (!st.enabled) {
          // Do not repeatedly popup on every tap; apply cooldown.
          await promptCallScreeningIfNeededWithOptions({ cooldownMs: 30_000 });
          // Still allow adding to DB, but user is warned that it won't block until enabled.
        }
      } catch (_e) {
        setScreeningEnabled(false);
        setScreeningReason("STATUS_ERROR");
        await promptCallScreeningIfNeededWithOptions({ cooldownMs: 30_000 });
      }
    }

    try {
      setLoading(true);
      await addBlockedNumber(trimmed);
      setPhoneInput("");
      await loadNumbers();
    } catch (e) {
      console.warn("[BlockedNumbers] add error:", e);
    } finally {
      setLoading(false);
      refreshCallScreeningStatus();
    }
  };

  const handleRemove = async (phone: string) => {
    Alert.alert(
      "ยืนยันลบ",
      `ต้องการเอาเบอร์ ${phone} ออกจากรายการบล็อกหรือไม่?`,
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await removeBlockedNumber(phone);
              await loadNumbers();
            } catch (e) {
              console.warn("[BlockedNumbers] remove error:", e);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>เบอร์ที่ถูกบล็อก</Text>

      {Platform.OS === "android" && (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>
            Caller ID & spam: {screeningEnabled ? "ENABLED" : screeningEnabled === false ? "NOT_ENABLED" : "UNKNOWN"}
          </Text>
          <Text style={styles.bannerText}>
            Status: {roleState || "UNKNOWN"}
            {screeningReason ? ` / ${screeningReason}` : ""}
          </Text>
          {!!lastScreenText && <Text style={styles.bannerDebug}>Last screen: {lastScreenText}</Text>}
          {!!summaryText && <Text style={styles.bannerDebug}>{summaryText}</Text>}
          {!!installText && <Text style={styles.bannerDebug}>{installText}</Text>}

          {screeningEnabled === false && (
            <Pressable
              style={styles.bannerButton}
              onPress={() => promptCallScreeningIfNeededWithOptions({ force: true, cooldownMs: 0 })}
            >
              <Text style={styles.bannerButtonText}>Open Settings / Check Again</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="กรอกเบอร์ที่จะบล็อก"
          keyboardType="phone-pad"
          value={phoneInput}
          onChangeText={setPhoneInput}
        />
        <Pressable
          style={[styles.addButton, (loading || !phoneInput.trim()) && styles.buttonDisabled]}
          onPress={handleAdd}
          disabled={loading || !phoneInput.trim()}
        >
          <Text style={styles.addButtonText}>เพิ่ม</Text>
        </Pressable>
      </View>

      <FlatList
        data={numbers}
        keyExtractor={(item) => item}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>ยังไม่มีเบอร์ที่ถูกบล็อก</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemText}>{item}</Text>
            <Pressable
              style={styles.removeButton}
              onPress={() => handleRemove(item)}
            >
              <Text style={styles.removeButtonText}>ลบ</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#111" },
  title: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 12 },
  banner: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#151515",
  },
  bannerTitle: { color: "#fff", fontWeight: "700", marginBottom: 6 },
  bannerText: { color: "#ccc", marginBottom: 8 },
  bannerDebug: { color: "#888", marginBottom: 10 },
  bannerButton: {
    alignSelf: "flex-start",
    backgroundColor: "#1e90ff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bannerButtonText: { color: "#fff", fontWeight: "600" },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
  },
  addButton: {
    backgroundColor: "#1e90ff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "600" },
  buttonDisabled: { opacity: 0.5 },
  list: { flex: 1 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  itemText: { color: "#fff", fontSize: 16 },
  removeButton: {
    backgroundColor: "#aa3333",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removeButtonText: { color: "#fff", fontSize: 14 },
  emptyText: { color: "#777", marginTop: 20 },
});
