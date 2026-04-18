import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { NativeModules } from "react-native";

export const HIDDEN_DIAGNOSTICS_KEY = "jachoei.hidden_debug_mode.v1";

type HiddenDiagListener = (enabled: boolean) => void;

let cachedEnabled = false;
let cacheHydrated = false;
let hydratePromise: Promise<boolean> | null = null;
const listeners = new Set<HiddenDiagListener>();

function notifyListeners(next: boolean) {
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore listener errors
    }
  });
}

function publishEnabled(next: boolean) {
  cachedEnabled = !!next;
  cacheHydrated = true;
  notifyListeners(cachedEnabled);
}

function subscribeHiddenDiagnostics(listener: HiddenDiagListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readEnabledFromStorage(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(HIDDEN_DIAGNOSTICS_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

async function writeEnabled(next: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(HIDDEN_DIAGNOSTICS_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }

  try {
    const mod: any = (NativeModules as any)?.CallBlocker;
    if (mod?.setHiddenDiagnosticsEnabled) {
      await mod.setHiddenDiagnosticsEnabled(!!next);
    }
  } catch {
    // ignore
  }
}

async function ensureHydrated(): Promise<boolean> {
  if (cacheHydrated) return cachedEnabled;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const v = await readEnabledFromStorage();
      publishEnabled(v);
      return v;
    })().finally(() => {
      hydratePromise = null;
    });
  }
  return hydratePromise;
}

export async function getHiddenDiagnosticsEnabled(): Promise<boolean> {
  return ensureHydrated();
}

export async function setHiddenDiagnosticsEnabled(next: boolean): Promise<void> {
  const v = !!next;
  publishEnabled(v);
  await writeEnabled(v);
}

export function useHiddenDiagnosticsMode() {
  const [enabled, setEnabledState] = useState(cachedEnabled);
  const [loaded, setLoaded] = useState(cacheHydrated);
  const inflightRef = useRef(false);

  const reload = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const v = await ensureHydrated();
      setEnabledState(v);
      setLoaded(true);

      // Best-effort: keep native side in sync.
      try {
        const mod: any = (NativeModules as any)?.CallBlocker;
        if (mod?.setHiddenDiagnosticsEnabled) {
          await mod.setHiddenDiagnosticsEnabled(!!v);
        }
      } catch {
        // ignore
      }
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return subscribeHiddenDiagnostics((next) => {
      setEnabledState(next);
      setLoaded(true);
    });
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    const v = !!next;
    publishEnabled(v);
    await writeEnabled(v);
  }, []);

  return { enabled, loaded, setEnabled, reload };
}
