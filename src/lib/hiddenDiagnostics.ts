import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { NativeModules } from "react-native";

export const HIDDEN_DIAGNOSTICS_KEY = "jachoei.hidden_debug_mode.v1";

async function readEnabled(): Promise<boolean> {
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

export async function getHiddenDiagnosticsEnabled(): Promise<boolean> {
  return readEnabled();
}

export async function setHiddenDiagnosticsEnabled(next: boolean): Promise<void> {
  await writeEnabled(!!next);
}

export function useHiddenDiagnosticsMode() {
  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inflightRef = useRef(false);

  const reload = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const v = await readEnabled();
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

  const setEnabled = useCallback(async (next: boolean) => {
    const v = !!next;
    setEnabledState(v);
    setLoaded(true);
    await writeEnabled(v);
  }, []);

  return { enabled, loaded, setEnabled, reload };
}
