// src/device/deviceInfo.ts
import DeviceInfo from "react-native-device-info";
import { Platform } from "react-native";

export type AppDeviceInfo = {
  deviceId: string;          // ✅ เป็น string จริง
  deviceName?: string;
  systemName: string;
  systemVersion: string;
  appVersion: string;
  buildNumber: string;
  platform: string;
  isEmulator: boolean;
};

let cachedDeviceInfo: AppDeviceInfo | null = null;

export async function loadDeviceInfo(): Promise<AppDeviceInfo> {
  if (cachedDeviceInfo) return cachedDeviceInfo;

  const [
    deviceId,
    deviceName,
    isEmulator,
  ] = await Promise.all([
    DeviceInfo.getUniqueId(),                 // ✅ await
    DeviceInfo.getDeviceName().catch(() => undefined),
    DeviceInfo.isEmulator(),
  ]);

  cachedDeviceInfo = {
    deviceId,
    deviceName,
    systemName: DeviceInfo.getSystemName(),
    systemVersion: DeviceInfo.getSystemVersion(),
    appVersion: DeviceInfo.getVersion(),
    buildNumber: DeviceInfo.getBuildNumber(),
    platform: Platform.OS,
    isEmulator,
  };

  return cachedDeviceInfo;
}

export function getCachedDeviceInfo(): AppDeviceInfo | null {
  return cachedDeviceInfo;
}
