import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeModules } from "react-native";

type DiagEvent = {
  ts: number;
  topic: string;
  msg: string;
  data?: Record<string, any>;
};

type DiagPayload = {
  dbPath: string;
  dbExists: boolean;
  dbSizeBytes: number;
  scamPhonesCount: number;
  localBlockedCount: number;
  events: DiagEvent[];
};

function formatTs(ts: number) {
  if (!ts) return "";
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

export default function DiagnosticsScreen() {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<DiagPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const mod: any = (NativeModules as any)?.CallBlocker;
    if (!mod?.getReleaseDiagnostics) {
      setError("Native CallBlocker.getReleaseDiagnostics not available");
      setPayload(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res: DiagPayload = await mod.getReleaseDiagnostics();
      setPayload(res);
    } catch (e: any) {
      setPayload(null);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Diagnostics</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={styles.btn} onPress={load}>
            <Text style={styles.btnText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>DB Snapshot</Text>
          <Text style={styles.mono}>dbPath: {payload?.dbPath || ""}</Text>
          <Text style={styles.mono}>dbExists: {String(payload?.dbExists ?? false)}</Text>
          <Text style={styles.mono}>dbSizeBytes: {String(payload?.dbSizeBytes ?? 0)}</Text>
          <Text style={styles.mono}>scamPhonesCount: {String(payload?.scamPhonesCount ?? 0)}</Text>
          <Text style={styles.mono}>localBlockedCount: {String(payload?.localBlockedCount ?? 0)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Events</Text>
          {(payload?.events || []).slice().reverse().map((ev, idx) => {
            const dataStr = ev.data ? JSON.stringify(ev.data) : "";
            return (
              <View key={`${ev.ts}_${idx}`} style={styles.eventRow}>
                <Text style={styles.eventMeta}>{formatTs(ev.ts)} • {ev.topic}</Text>
                <Text style={styles.eventMsg}>{ev.msg}</Text>
                {dataStr ? <Text style={styles.eventData}>{dataStr}</Text> : null}
              </View>
            );
          })}
          {(payload?.events?.length || 0) === 0 ? (
            <Text style={styles.empty}>No diagnostics yet.</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0f" },
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  title: { color: "#fff", fontWeight: "900", fontSize: 18 },
  btn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "900" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "700" },
  error: { color: "#ff7b7b", paddingHorizontal: 16, paddingTop: 10 },
  body: { padding: 16, paddingBottom: 30 },
  card: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#101010",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontWeight: "900", fontSize: 16, marginBottom: 10 },
  mono: { color: "rgba(255,255,255,0.8)", fontFamily: "Courier", fontSize: 12, marginBottom: 6 },
  eventRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  eventMeta: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginBottom: 6 },
  eventMsg: { color: "#fff", fontWeight: "800" },
  eventData: { color: "rgba(255,255,255,0.75)", fontFamily: "Courier", fontSize: 12, marginTop: 6 },
  empty: { color: "rgba(255,255,255,0.6)", paddingTop: 8 },
});
