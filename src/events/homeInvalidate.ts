import { DeviceEventEmitter } from "react-native";

const HOME_INVALIDATE_EVENT = "JACHOEI_HOME_INVALIDATE";

type HomeInvalidateEvent = {
  reason?: string;
  ts?: number;
};

export function emitHomeInvalidate(reason?: string) {
  const payload: HomeInvalidateEvent = {
    reason: reason ? String(reason) : undefined,
    ts: Date.now(),
  };
  DeviceEventEmitter.emit(HOME_INVALIDATE_EVENT, payload);
}

export function subscribeHomeInvalidate(cb: (e: HomeInvalidateEvent) => void) {
  const sub = DeviceEventEmitter.addListener(HOME_INVALIDATE_EVENT, cb);
  return () => sub.remove();
}
