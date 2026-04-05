import { toastGenericError, toastError } from "../toast";
import { enqueueClientLog, newClientLog } from "./clientLog";
import { getLogContext } from "./logContext";
import { safeErrorMessage, safeStack } from "./redact";

export type SafeExecuteOptions = {
  screenName?: string;
  payload?: any;

  showErrorToast?: boolean;
  errorToastMessage?: string;

  // If true, rethrow after logging + toast.
  rethrow?: boolean;

  // Override correlation id to connect multiple actions.
  correlationId?: string;
};

function newCorrelationId(): string {
  return `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function safeExecute<T>(
  action: string,
  fn: () => Promise<T>,
  options: SafeExecuteOptions = {}
): Promise<T | null> {
  const startedAt = Date.now();
  const correlationId = options.correlationId || newCorrelationId();
  const ctx = getLogContext();

  void enqueueClientLog(
    newClientLog({
      action,
      status: "start",
      message: action,
      payload: options.payload ?? null,
      correlationId,
      screenName: options.screenName ?? null,
      routeName: ctx.routeName,
    })
  );

  try {
    const result = await fn();

    void enqueueClientLog(
      newClientLog({
        action,
        status: "success",
        message: action,
        payload: options.payload ?? null,
        correlationId,
        durationMs: Date.now() - startedAt,
        screenName: options.screenName ?? null,
        routeName: ctx.routeName,
      })
    );

    return result;
  } catch (err) {
    const errorMessage = safeErrorMessage(err);
    const stack = safeStack(err);

    void enqueueClientLog(
      newClientLog({
        action,
        status: "error",
        message: action,
        payload: options.payload ?? null,
        correlationId,
        durationMs: Date.now() - startedAt,
        errorMessage,
        stack,
        screenName: options.screenName ?? null,
        routeName: ctx.routeName,
      })
    );

    const showToast = options.showErrorToast !== false;
    if (showToast) {
      if (options.errorToastMessage) toastError(options.errorToastMessage);
      else toastGenericError();
    }

    if (options.rethrow) throw err;
    return null;
  }
}
