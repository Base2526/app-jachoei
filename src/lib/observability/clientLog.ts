import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { ENV } from "../../config/env";
import { loadAuth } from "../../auth/auth.storage";
import { getCachedDeviceInfo } from "../../device/deviceInfo";

import { getLogContext } from "./logContext";
import { redactDeep, clampString } from "./redact";

export type ClientLogStatus = "start" | "success" | "error";

export type ClientLog = {
  id: string;
  action: string;
  status: ClientLogStatus;
  message?: string | null;
  payload?: any;
  errorMessage?: string | null;
  stack?: string | null;
  timestamp: string;

  userId?: string | null;
  screenName?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
  deviceInfo?: any;
  appVersion?: string | null;
  platform?: string | null;
  routeName?: string | null;
  durationMs?: number | null;
};

const QUEUE_KEY = "jachoei.client_log_queue_v1";
const MAX_QUEUE = 400;

let flushTimer: any = null;
let flushing = false;

let memQueue: ClientLog[] | null = null;
let persistTimer: any = null;
let loadPromise: Promise<void> | null = null;

function newId(): string {
  return `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function shouldKeepLog(log: ClientLog) {
  // Always keep errors.
  if (log.status === "error") return true;

  const action = String(log.action || "");
  if (/^AUDIO_/i.test(action)) return true;
  if (/UNCAUGHT_ERROR|UNHANDLED_REJECTION/i.test(action)) return true;

  // Production sampling for noisy non-error logs.
  if (!__DEV__) {
    // Keep ~30% of start/success by default.
    return Math.random() < 0.3;
  }

  return true;
}

async function ensureMemQueueLoaded() {
  if (memQueue) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      const arr: ClientLog[] = raw ? (JSON.parse(raw) as any) : [];
      memQueue = Array.isArray(arr) ? arr : [];
    } catch {
      memQueue = [];
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function schedulePersistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        if (!memQueue) return;
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(memQueue));
      } catch {
        // best-effort
      }
    })();
  }, 900);
}

function buildMeta(log: ClientLog) {
  const device = getCachedDeviceInfo();
  const ctx = getLogContext();

  const meta = {
    id: log.id,
    action: log.action,
    status: log.status,
    message: log.message ?? null,

    payload: log.payload ?? null,
    errorMessage: log.errorMessage ?? null,
    stack: log.stack ?? null,

    timestamp: log.timestamp,
    userId: log.userId ?? ctx.userId ?? null,
    screenName: log.screenName ?? null,
    sessionId: log.sessionId ?? ctx.sessionId ?? null,
    correlationId: log.correlationId ?? null,
    routeName: log.routeName ?? ctx.routeName ?? null,
    durationMs: log.durationMs ?? null,

    deviceInfo: log.deviceInfo ?? device ?? null,
    appVersion: log.appVersion ?? device?.appVersion ?? null,
    platform: log.platform ?? Platform.OS,
    networkState: "unknown",
  };

  return redactDeep(meta);
}

async function sendBatch(logs: ClientLog[]) {
  const { token } = await loadAuth().catch(() => ({ token: null } as any));
  const url = `${ENV.apiBase}/api/logs`;

  const body = {
    logs: logs.map((l) => {
      const meta = buildMeta(l);
      return {
        level: l.status === "error" ? "error" : "info",
        category: "mobile",
        message: clampString(l.message || l.action, 500),
        meta,

        action: l.action,
        status: l.status,
        correlationId: l.correlationId ?? null,
        sessionId: (meta as any).sessionId ?? null,
        screenName: (meta as any).screenName ?? null,
        routeName: (meta as any).routeName ?? null,
        platform: (meta as any).platform ?? Platform.OS,
        appVersion: (meta as any).appVersion ?? null,
        durationMs: (meta as any).durationMs ?? null,
        errorMessage: (meta as any).errorMessage ?? null,
        stack: (meta as any).stack ?? null,
        deviceInfo: (meta as any).deviceInfo ?? null,
      };
    }),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`log send failed: ${res.status}`);
  }
}

export async function enqueueClientLog(log: ClientLog) {
  if (!shouldKeepLog(log)) return;

  await ensureMemQueueLoaded();

  try {
    const q = memQueue ?? [];
    q.push(log);
    if (q.length > MAX_QUEUE) memQueue = q.slice(-MAX_QUEUE);
    else memQueue = q;
    schedulePersistSoon();
  } catch {
    // never crash
  }

  scheduleFlushSoon();
}

export async function flushClientLogQueue(maxBatch = 25) {
  if (flushing) return;
  flushing = true;

  try {
    await ensureMemQueueLoaded();
    const list = memQueue ?? [];
    if (!list.length) return;

    const batch = list.slice(0, maxBatch);
    await sendBatch(batch);

    const remain = list.slice(batch.length);
    memQueue = remain;
    schedulePersistSoon();

    if (remain.length) scheduleFlushSoon();
  } catch {
    // best-effort only
  } finally {
    flushing = false;
  }
}

function scheduleFlushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushClientLogQueue();
  }, 1200);
}

export function newClientLog(args: Omit<ClientLog, "id" | "timestamp"> & { id?: string }) {
  return {
    id: args.id || newId(),
    timestamp: new Date().toISOString(),
    ...args,
  } satisfies ClientLog;
}
