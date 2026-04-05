import {
  ApolloClient,
  InMemoryCache,
  ApolloLink,
  HttpLink,
  split,
  Observable,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { getMainDefinition } from "@apollo/client/utilities";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { ErrorLink } from "@apollo/client/link/error";
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from "@apollo/client/errors";

import { ENV } from "../config/env";
import { getCachedDeviceInfo } from "../device/deviceInfo";
import { loadAuth } from "../auth/auth.storage";
import {
  createGraphQLMultipartLink,
  operationHasReactNativeUpload,
} from "./multipartLink";

import { enqueueClientLog, newClientLog } from "../lib/observability/clientLog";
import { redactDeep, clampString, safeErrorMessage } from "../lib/observability/redact";

function newCorrelationId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ================= Error Link (HTTP only) =================
const errorLink = new ErrorLink(({ error, operation }) => {
  try {
    const opName = operation.operationName || "anonymous";
    const correlationId = String((operation.getContext() as any)?.correlationId || "").trim() || null;

    if (CombinedGraphQLErrors.is(error)) {
      error.errors.forEach((e) => {
        console.log(
          "[GraphQL error]",
          e.message,
          e.path,
          operation.operationName
        );
      });

      void enqueueClientLog(
        newClientLog({
          action: "API_GQL_ERROR",
          status: "error",
          message: `GraphQL error: ${opName}`,
          errorMessage: clampString(error.errors.map((e) => e.message).join(" | "), 600),
          payload: {
            operationName: opName,
            errors: error.errors.map((e) => ({ message: clampString(e.message, 240), path: e.path })),
          },
          correlationId: correlationId ?? undefined,
          screenName: "Apollo",
        })
      );
      return;
    }

    if (CombinedProtocolErrors.is(error)) {
      error.errors.forEach((e) => {
        console.log("[Protocol error]", e.message);
      });

      void enqueueClientLog(
        newClientLog({
          action: "API_PROTOCOL_ERROR",
          status: "error",
          message: `Protocol error: ${opName}`,
          errorMessage: clampString(error.errors.map((e) => e.message).join(" | "), 600),
          payload: { operationName: opName },
          correlationId: correlationId ?? undefined,
          screenName: "Apollo",
        })
      );
      return;
    }

    if (error) {
      console.log("[Network error]", error);
      void enqueueClientLog(
        newClientLog({
          action: "API_NETWORK_ERROR",
          status: "error",
          message: `Network error: ${opName}`,
          errorMessage: safeErrorMessage(error),
          payload: { operationName: opName },
          correlationId: correlationId ?? undefined,
          screenName: "Apollo",
        })
      );
    }
  } catch {
    // never crash
  }

  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log(
        "[GraphQL error]",
        e.message,
        e.path,
        operation.operationName
      );
    });
    return;
  }

  if (CombinedProtocolErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log("[Protocol error]", e.message);
    });
    return;
  }

  if (error) console.log("[Network error]", error);
});

// ================= Observability Link =================
const observabilityLink = new ApolloLink((operation, forward) => {
  const startedAt = Date.now();
  const opName = operation.operationName || "anonymous";
  const correlationId = newCorrelationId();

  operation.setContext((prev) => ({
    ...prev,
    correlationId,
    observabilityStartedAt: startedAt,
  }));

  try {
    const safeVars = redactDeep(operation.variables ?? {});
    void enqueueClientLog(
      newClientLog({
        action: "API_GQL_REQUEST",
        status: "start",
        message: `GQL ${opName}`,
        payload: {
          operationName: opName,
          hasUpload: operationHasReactNativeUpload(operation),
          variables: clampString(JSON.stringify(safeVars), 1800),
        },
        correlationId,
        screenName: "Apollo",
      })
    );
  } catch {
    // ignore
  }

  // Defensive: ensure we always return a valid Observable.
  if (!forward) {
    console.warn("[Apollo][observabilityLink] missing forward for op", opName);
    return new Observable((observer) => {
      observer.error(new Error("ApolloLink forward is missing"));
    });
  }

  const forwarded = forward(operation) as any;
  if (!forwarded || typeof forwarded.subscribe !== "function") {
    console.warn("[Apollo][observabilityLink] forward(operation) returned non-observable", {
      opName,
      type: typeof forwarded,
    });
    return new Observable((observer) => {
      observer.error(new Error("ApolloLink forward(operation) did not return an Observable"));
    });
  }

  return new Observable((observer) => {
    const sub = forwarded.subscribe({
      next: (result: any) => {
        const durationMs = Date.now() - startedAt;
        try {
          void enqueueClientLog(
            newClientLog({
              action: "API_GQL_RESPONSE",
              status: "success",
              message: `GQL ${opName}`,
              payload: {
                operationName: opName,
                hasErrors: Array.isArray(result?.errors) && result.errors.length > 0,
              },
              correlationId,
              durationMs,
              screenName: "Apollo",
            })
          );
        } catch {
          // ignore
        }
        observer.next(result);
      },
      error: (err: any) => {
        const durationMs = Date.now() - startedAt;
        try {
          void enqueueClientLog(
            newClientLog({
              action: "API_GQL_RESPONSE",
              status: "error",
              message: `GQL ${opName}`,
              errorMessage: safeErrorMessage(err),
              payload: { operationName: opName },
              correlationId,
              durationMs,
              screenName: "Apollo",
            })
          );
        } catch {
          // ignore
        }
        observer.error(err);
      },
      complete: () => {
        observer.complete();
      },
    });

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch {
        // ignore
      }
    };
  });
});

// ================= HTTP Link =================
const httpLink = new HttpLink({
  uri: `${ENV.apiBase}/api/graphql`,
});

// ================= Multipart Upload Link (React Native) =================
// Sends GraphQL multipart requests for variables containing { uri, name, type }
const multipartLink = createGraphQLMultipartLink({
  uri: `${ENV.apiBase}/api/graphql`,
});

// ✅ Auth + Device headers for HTTP (สำคัญมาก)
const authLink = setContext(async (_, { headers }) => {
  const { token } = await loadAuth();
  const device = getCachedDeviceInfo();

  return {
    headers: {
      ...headers,
      Authorization: token ? `Bearer ${token}` : "",

      // scope/app headers
      "x-scope": "android",
      "x-app": ENV.appName,

      ...(device && {
        "x-device-id": device.deviceId,
        "x-device-name": device.deviceName,
        "x-os": device.systemName,
        "x-os-version": device.systemVersion,
        "x-app-version": device.appVersion,
        "x-build-number": device.buildNumber,
        "x-platform": device.platform,
        "x-emulator": String(device.isEmulator),
      }),
    },
  };
});

// ================= WS Link =================
console.log("[API_BASE] =", ENV.apiBase);
console.log("[WS_URL] =", ENV.wsUrl);

const wsLink = new GraphQLWsLink(
  createClient({
    url: ENV.wsUrl,
    lazy: true,
    retryAttempts: Infinity,

    connectionParams: async () => {
      const { token } = await loadAuth();
      const device = getCachedDeviceInfo();

      return {
        Authorization: token ? `Bearer ${token}` : "",
        "x-scope": "android",
        "x-app": ENV.appName,

        ...(device && {
          "x-device-id": device.deviceId,
          "x-device-name": device.deviceName,
          "x-os": device.systemName,
          "x-os-version": device.systemVersion,
          "x-app-version": device.appVersion,
          "x-build-number": device.buildNumber,
          "x-platform": device.platform,
          "x-emulator": String(device.isEmulator),
        }),
      };
    },

    on: {
      connected: () => console.log("[WS] connected"),
      closed: (e) => console.log("[WS] closed", e),
      error: (e) => console.log("[WS] error", e),
    },
  })
);

// ================= Split (sub => ws, else => http) =================
const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return (
      def.kind === "OperationDefinition" &&
      def.operation === "subscription"
    );
  },
  wsLink,
  ApolloLink.from([
    observabilityLink,
    errorLink, // log errors
    authLink, // ✅ ใส่ header token ที่นี่

    // If the operation contains RN upload objects, use multipart.
    split(operationHasReactNativeUpload, multipartLink, httpLink),
  ])
);

// ================= Apollo Client =================
export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});