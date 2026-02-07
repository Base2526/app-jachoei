// src/config/env.ts
import { Platform } from "react-native";

export const ENV = {
    isDev: __DEV__,
    apiBase:
        __DEV__
        ? Platform.OS === "android"
            ? "http://192.168.1.6:3000"
            : "http://localhost:3000"
        : "https://jachoei.com",
    webBase: __DEV__
        ? Platform.OS === "android"
            ? "http://192.168.1.6:3000"
            : "http://localhost:3000"
        : "https://jachoei.com",
    appName: "jachoei"
};
