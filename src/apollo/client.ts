// apollo/client.ts
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
} from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from "@apollo/client/errors";

import { ENV } from "../config/env";

import { getCachedDeviceInfo } from "../device/deviceInfo";

// fetch(`${ENV.apiBase}/api/graphql`);

const errorLink = new ErrorLink(({ error, operation }) => {
  // GraphQL errors (จาก server)
  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log(
        "[GraphQL error]",
        "\n message:", e.message,
        "\n locations:", e.locations,
        "\n path:", e.path,
        "\n operation:", operation.operationName
      );
    });
    return;
  }

  // Protocol errors (response shape ผิด spec)
  if (CombinedProtocolErrors.is(error)) {
    error.errors.forEach((e) => {
      console.log(
        "[Protocol error]",
        "\n message:", e.message,
        "\n extensions:", e.extensions
      );
    });
    return;
  }

  // Network / unknown
  if (error) console.log("[Network error]", error);
});

const headerLink = new ApolloLink((operation, forward) => {

  const device = getCachedDeviceInfo();

  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      "x-scope": "android",
      "x-app": ENV.appName,
       // ===== device info =====
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
  }));

  // console.log("[headerLink] outgoing headers:", operation.getContext().headers);

  if (!forward) {
    console.log("[headerLink] forward is undefined");
    return null as any;
  }
  return forward(operation);
});

const httpLink = new HttpLink({ uri: `${ENV.apiBase}/api/graphql` });
export const client = new ApolloClient({
  link: ApolloLink.from([errorLink, headerLink, httpLink]),
  cache: new InMemoryCache(),
});
