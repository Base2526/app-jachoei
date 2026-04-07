import { Platform } from "react-native";

import { enqueueClientLog, newClientLog } from "./clientLog";
import { safeErrorMessage, safeStack } from "./redact";
import { toastError } from "../toast";

export function installGlobalErrorHandlers() {
  // ===== JS uncaught errors =====
  try {
    const ErrorUtilsAny: any = (globalThis as any).ErrorUtils;
    const prevHandler =
      typeof ErrorUtilsAny?.getGlobalHandler === "function"
        ? ErrorUtilsAny.getGlobalHandler()
        : null;

    if (typeof ErrorUtilsAny?.setGlobalHandler === "function") {
      ErrorUtilsAny.setGlobalHandler((err: any, isFatal?: boolean) => {
        try {
          void enqueueClientLog(
            newClientLog({
              action: "UNCAUGHT_ERROR",
              status: "error",
              message: safeErrorMessage(err),
              errorMessage: safeErrorMessage(err),
              stack: safeStack(err),
              payload: { isFatal: !!isFatal, platform: Platform.OS },
              screenName: "App",
            })
          );

          if (!__DEV__) {
            toastError("Something went wrong. Please try again.");
          }
        } catch {
          // ignore
        } finally {
          try {
            prevHandler?.(err, isFatal);
          } catch {
            // ignore
          }
        }
      }, true);
    }
  } catch {
    // ignore
  }

  // ===== Unhandled promise rejections =====
  try {
    const rej = require("promise/setimmediate/rejection-tracking");
    rej.enable({
      allRejections: true,
      onUnhandled: (_id: any, error: any) => {
        try {
          void enqueueClientLog(
            newClientLog({
              action: "UNHANDLED_REJECTION",
              status: "error",
              message: safeErrorMessage(error),
              errorMessage: safeErrorMessage(error),
              stack: safeStack(error),
              payload: { platform: Platform.OS },
              screenName: "App",
            })
          );
        } catch {
          // ignore
        }
      },
      onHandled: () => {
        // no-op
      },
    });
  } catch {
    // ignore
  }
}
