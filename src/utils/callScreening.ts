import { Alert, Platform } from "react-native";
import {
  ensureCallScreeningRole,
  getCallScreeningStatus,
  openCallerIdAndSpamSettings,
} from "../native/CallBlocker";

export type CallScreeningStatus = Awaited<ReturnType<typeof getCallScreeningStatus>>;

type PromptOptions = {
  /** If the dialog was shown recently, skip showing it again. */
  cooldownMs?: number;
  /** Force showing even within cooldown. */
  force?: boolean;
};

let lastPromptAt = 0;
let lastPromptState: string | null = null;

export async function checkCallScreeningStatus(): Promise<CallScreeningStatus | null> {
  if (Platform.OS !== "android") return null;
  return await getCallScreeningStatus();
}

/**
 * Critical UX guard: if call screening isn't enabled, show the user how to enable it.
 * Returns the latest status after the user's action attempt.
 */
export async function promptCallScreeningIfNeeded(): Promise<CallScreeningStatus | null> {
  return await promptCallScreeningIfNeededWithOptions({});
}

export async function promptCallScreeningIfNeededWithOptions(
  opts: PromptOptions
): Promise<CallScreeningStatus | null> {
  if (Platform.OS !== "android") return null;

  const cooldownMs = Math.max(0, opts.cooldownMs ?? 30_000);

  let st: CallScreeningStatus;
  try {
    st = await getCallScreeningStatus();
  } catch (_e) {
    st = {
      sdk: -1,
      packageName: "",
      supported: true,
      enabled: false,
      reason: "STATUS_ERROR",
    } as any;
  }

  if (st.enabled) return st;

  const now = Date.now();
  const state = String((st as any).state || st.reason || "UNKNOWN");
  if (!opts.force && now - lastPromptAt < cooldownMs && lastPromptState === state) {
    // Skip aggressive re-prompting.
    return st;
  }
  lastPromptAt = now;
  lastPromptState = state;

  const lines: string[] = [];
  lines.push(
    "To block scam calls, please enable Jachoei as your Caller ID & spam app. Without this, Android will not trigger call screening and blocked numbers will not block calls."
  );
  lines.push("");
  lines.push(`Detected: ${(st as any).state || "UNKNOWN"} (reason: ${st.reason || ""})`);
  lines.push(`Android SDK: ${st.sdk ?? "?"}`);
  if ((st as any).isEmulator) {
    lines.push("");
    lines.push(
      "Note: You are running on an emulator. Some emulators do not fully support call screening / spam role behavior. Please verify on a real device."
    );
  }

  const showDialog = (current: CallScreeningStatus, depth: number) => {
    Alert.alert("Enable Caller ID & spam", lines.join("\n"), [
      {
        text: "Open Settings",
        onPress: async () => {
          try {
            // Best-effort: try role request first (Android 10+), then open settings.
            await ensureCallScreeningRole();
          } catch (_e) {
            // ignore
          }
          try {
            await openCallerIdAndSpamSettings();
          } catch (_e2) {
            // ignore
          }
        },
      },
      {
        text: "Check Again",
        onPress: async () => {
          let st2: CallScreeningStatus;
          try {
            st2 = await getCallScreeningStatus();
          } catch (_e) {
            st2 = current;
          }
          if (st2.enabled) return;
          if (depth < 2) showDialog(st2, depth + 1);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  showDialog(st, 0);
  return st;
}
