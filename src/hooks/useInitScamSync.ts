// src/hooks/useInitScamSync.ts
import { useEffect, useState } from "react";
import { NativeModules } from "react-native";
import { client } from "../apollo/client";
import { initDb } from "../lib/db";
import {
  initialScamSync,
  deltaScamSync,
} from "../lib/syncScamPhones";

export function useInitScamSync() {
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        try {
          const mod: any = (NativeModules as any)?.CallBlocker;
          if (mod?.recordReleaseDiagnostic) {
            await mod.recordReleaseDiagnostic("SCAM_SYNC", "init start", {
              hasClient: !!client,
            });
          }
        } catch {
          // ignore
        }

        await initDb();

        try {
          const mod: any = (NativeModules as any)?.CallBlocker;
          if (mod?.recordReleaseDiagnostic) {
            await mod.recordReleaseDiagnostic("SCAM_SYNC", "initDb OK", null);
          }
        } catch {
          // ignore
        }

        setSyncing(true);

        // ถ้าจะให้ initial sync แค่ครั้งแรกจริง ๆ
        // อนาคตค่อยเช็ก flag ใน sync_state
        await initialScamSync(client, 1000);
        await deltaScamSync(client, 1000);

        try {
          const mod: any = (NativeModules as any)?.CallBlocker;
          if (mod?.recordReleaseDiagnostic) {
            await mod.recordReleaseDiagnostic("SCAM_SYNC", "sync OK", null);
          }
        } catch {
          // ignore
        }
      } catch (e) {
        console.warn("[ScamSync] error", e);

        try {
          const mod: any = (NativeModules as any)?.CallBlocker;
          if (mod?.recordReleaseDiagnostic) {
            await mod.recordReleaseDiagnostic("SCAM_SYNC", "sync ERROR", {
              message: (e as any)?.message || String(e),
            });
          }
        } catch {
          // ignore
        }
      } finally {
        setSyncing(false);
        setReady(true);

        try {
          const mod: any = (NativeModules as any)?.CallBlocker;
          if (mod?.recordReleaseDiagnostic) {
            await mod.recordReleaseDiagnostic("SCAM_SYNC", "init done", {
              ready: true,
            });
          }
        } catch {
          // ignore
        }
      }
    })();
  }, []);

  return { ready, syncing };
}
