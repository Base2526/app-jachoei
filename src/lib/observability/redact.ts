function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "pass",
  "secret",
  "api_key",
  "apikey",
]);

export function redactDeep(value: any): any {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!isPlainObject(value)) return value;

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    const keyLower = String(k).toLowerCase();
    if (SENSITIVE_KEYS.has(keyLower)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactDeep(v);
  }
  return out;
}

export function clampString(s: unknown, maxLen: number): string {
  const text = String(s ?? "");
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function safeErrorMessage(err: unknown, maxLen = 600): string {
  const anyErr = err as any;
  const msg = anyErr?.message ? String(anyErr.message) : String(err ?? "");
  return clampString(msg, maxLen);
}

export function safeStack(err: unknown, maxLen = 4000): string {
  const anyErr = err as any;
  const st = anyErr?.stack ? String(anyErr.stack) : "";
  return clampString(st, maxLen);
}
