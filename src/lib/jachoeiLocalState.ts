import AsyncStorage from "@react-native-async-storage/async-storage";

export const BLOCKED_TEL_STORE_KEY = "jachoei.blocked_tel_v1";
export const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";

export const TEL_BLOCK_DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel

export const DEVICE_CLIENT_ID_KEY = "jachoei.device_client_id_v1";

export type TelReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
export type BankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type StoredBlockedTelEntry = {
  wantReport?: boolean;
  category?: TelReportCategory;
  note?: string;
  blockedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredReportedBankEntry = {
  bank_name?: string | null;
  category?: BankReportCategory;
  note?: string;
  reportedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredBlockedTelMap = Record<string, StoredBlockedTelEntry>;
export type StoredReportedBankMap = Record<string, StoredReportedBankEntry>;

export function normalizeTel(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeBankAccount(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function sanitizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function sanitizeBlockedTelEntry(input: unknown): StoredBlockedTelEntry {
  const base = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const wantReport = typeof base.wantReport === "boolean" ? base.wantReport : undefined;

  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SPAM" || categoryRaw === "SCAM" || categoryRaw === "SALES" || categoryRaw === "HARASS" || categoryRaw === "OTHER"
      ? (categoryRaw as TelReportCategory)
      : undefined;

  const note = typeof base.note === "string" ? base.note : undefined;
  const blockedAt = typeof base.blockedAt === "string" ? base.blockedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return { wantReport, category, note, blockedAt, ctx, tags };
}

function sanitizeReportedBankEntry(input: unknown): StoredReportedBankEntry {
  const base = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const bank_name =
    typeof base.bank_name === "string" ? base.bank_name : base.bank_name === null ? null : undefined;

  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SCAM" ||
    categoryRaw === "MONEY_MULE" ||
    categoryRaw === "SALES_ADS" ||
    categoryRaw === "DISPUTE" ||
    categoryRaw === "OTHER"
      ? (categoryRaw as BankReportCategory)
      : undefined;

  const note = typeof base.note === "string" ? base.note : undefined;
  const reportedAt = typeof base.reportedAt === "string" ? base.reportedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return { bank_name, category, note, reportedAt, ctx, tags };
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function loadBlockedTelMap(): Promise<StoredBlockedTelMap> {
  const parsed = await readJson(BLOCKED_TEL_STORE_KEY);
  const out: StoredBlockedTelMap = {};

  if (Array.isArray(parsed)) {
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeTel(v);
      if (!k) continue;
      out[k] = {};
    }
    await writeJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeTel(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeBlockedTelEntry(v);
        continue;
      }

      if (v) out[k] = {};
    }

    await writeJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  return out;
}

export async function saveBlockedTelMap(map: StoredBlockedTelMap): Promise<void> {
  await writeJson(BLOCKED_TEL_STORE_KEY, map);
}

export async function loadReportedBankMap(): Promise<StoredReportedBankMap> {
  const parsed = await readJson(REPORTED_BANK_STORE_KEY);
  const out: StoredReportedBankMap = {};

  if (Array.isArray(parsed)) {
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeBankAccount(v);
      if (!k) continue;
      out[k] = {};
    }
    await writeJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeBankAccount(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeReportedBankEntry(v);
        continue;
      }

      if (v) out[k] = {};
    }

    await writeJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  return out;
}

export async function saveReportedBankMap(map: StoredReportedBankMap): Promise<void> {
  await writeJson(REPORTED_BANK_STORE_KEY, map);
}

function genClientId(): string {
  const rand = () => Math.random().toString(16).slice(2);
  return (rand() + rand() + Date.now().toString(16) + rand()).slice(0, 32);
}

export async function getDeviceClientId(): Promise<string> {
  try {
    const existed = await AsyncStorage.getItem(DEVICE_CLIENT_ID_KEY);
    if (existed && typeof existed === "string" && existed.length > 0) return existed;
    const created = genClientId();
    await AsyncStorage.setItem(DEVICE_CLIENT_ID_KEY, created);
    return created;
  } catch {
    return genClientId();
  }
}

export function encodeBankCategoryIntoText(category: BankReportCategory | undefined, text: string | null | undefined): string | null {
  const base = (text ?? "").trim();
  if (!category) return base || null;
  const prefix = `[CATEGORY=${category}]`;
  if (!base) return prefix;
  if (base.startsWith(prefix)) return base;
  return `${prefix} ${base}`;
}

type ClearUserScopedLocalDataResult = {
  userId: string;
  removedKeys: string[];
};

const USER_SCOPED_EXACT_KEYS = [
  BLOCKED_TEL_STORE_KEY,
  REPORTED_BANK_STORE_KEY,
  "jachoei_global_search_history_v1",
  "@blocked_logs_search_history",
];

const USER_SCOPED_PREFIXES = {
  dontAsk: TEL_BLOCK_DONT_ASK_PREFIX,
  blockedPhones: "jachoei.blockedPhones.v2.",
  searchHistory: "jachoei.search_history.v2.",
  bankReportedLocal: "jachoei.bank_reported_local.v1.",
};

function shouldRemoveScopedKey(key: string, userId: string): boolean {
  if (!key) return false;
  if (USER_SCOPED_EXACT_KEYS.includes(key)) return true;
  if (key.startsWith(USER_SCOPED_PREFIXES.dontAsk)) return true;

  if (key.startsWith(USER_SCOPED_PREFIXES.blockedPhones)) {
    const uid = key.slice(USER_SCOPED_PREFIXES.blockedPhones.length);
    return uid === userId || uid === "guest";
  }

  if (key.startsWith(USER_SCOPED_PREFIXES.searchHistory)) {
    return key.endsWith(`.${userId}`) || key.endsWith(".guest");
  }

  if (key.startsWith(USER_SCOPED_PREFIXES.bankReportedLocal)) {
    return key.includes(`.${userId}.`) || key.includes(".guest.");
  }

  return false;
}

export async function clearUserScopedLocalData(currentUserId?: string | null): Promise<ClearUserScopedLocalDataResult> {
  const userId = String(currentUserId || "").trim() || "guest";
  const allKeys = await AsyncStorage.getAllKeys().catch(() => [] as string[]);
  const removedKeys = allKeys.filter((key) => shouldRemoveScopedKey(String(key || ""), userId));

  console.log("[LOGOUT_CLEAR_USER_DATA_START]", { userId, totalKeys: allKeys.length });

  if (removedKeys.length > 0) {
    removedKeys.forEach((key) => console.log("[LOGOUT_CLEAR_KEY]", key));
    await AsyncStorage.multiRemove(removedKeys).catch(() => {});
  }

  console.log("[LOGOUT_CLEAR_USER_DATA_DONE]", { userId, removedCount: removedKeys.length });
  return { userId, removedKeys };
}
