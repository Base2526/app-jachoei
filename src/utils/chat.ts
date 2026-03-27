export function createClientMessageId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `rn-${Date.now()}-${rand}`;
}
