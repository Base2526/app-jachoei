// src/hooks/useInitScamSync.ts
import { useEffect, useState } from "react";
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
        await initDb();
        setSyncing(true);

        // ถ้าจะให้ initial sync แค่ครั้งแรกจริง ๆ
        // อนาคตค่อยเช็ก flag ใน sync_state
        await initialScamSync(client, 1000);
        await deltaScamSync(client, 1000);
      } catch (e) {
        console.warn("[ScamSync] error", e);
      } finally {
        setSyncing(false);
        setReady(true);
      }
    })();
  }, []);

  return { ready, syncing };
}
