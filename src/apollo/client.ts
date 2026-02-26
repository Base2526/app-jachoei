import {
  ApolloClient,
  InMemoryCache,
  ApolloLink,
  HttpLink,
  split,
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

// ================= Error Link (HTTP only) =================
const errorLink = new ErrorLink(({ error, operation }) => {
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

// ================= HTTP Link =================
const httpLink = new HttpLink({
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
    errorLink,          // log errors
    authLink,           // ✅ ใส่ header token ที่นี่
    httpLink,
  ])
);

// ================= Apollo Client =================
export const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});