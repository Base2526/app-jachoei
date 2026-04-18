// src/config/env.ts
import { Platform } from "react-native";

export const ENV = {
    isDev: __DEV__,
    apiBase: __DEV__
        ? Platform.OS === "android" ? "http://192.168.1.60:3000" : "http://localhost:3000"
        : "https://jachoei.com",
    webBase: __DEV__
        ? Platform.OS === "android" ? "http://192.168.1.60:3000" : "http://localhost:3000"
        : "https://jachoei.com",
    appName: "jachoei",
    wsUrl: __DEV__
        ? Platform.OS === "android" ? "ws://10.0.2.2:8081/graphql" : "ws://localhost:8081/graphql"
        : "wss://jachoei.com/graphql", 
};

// export const ENV = {
//   isDev: __DEV__,
//   apiBase: "https://jachoei.com",
//   webBase: "https://jachoei.com",
//   appName: "jachoei", 
//   wsUrl: "wss://jachoei.com/graphql",
// };