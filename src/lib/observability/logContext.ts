export type LogContext = {
  userId: string | null;
  sessionId: string | null;
  routeName: string | null;
};

let ctx: LogContext = {
  userId: null,
  sessionId: null,
  routeName: null,
};

export function getLogContext(): LogContext {
  return ctx;
}

export function setLogUserId(userId: string | null) {
  ctx = { ...ctx, userId: userId ? String(userId) : null };
}

export function setLogSessionId(sessionId: string | null) {
  ctx = { ...ctx, sessionId: sessionId ? String(sessionId) : null };
}

export function setLogRouteName(routeName: string | null) {
  ctx = { ...ctx, routeName: routeName ? String(routeName) : null };
}
