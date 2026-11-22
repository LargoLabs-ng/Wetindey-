/**
 * A small per-user rate limit for the inbox routes: best effort, in memory,
 * per server instance — the same approach as ticket recovery. Enough to stop
 * a stuck tab or a script hammering the bell.
 */
const windows = new Map<string, { start: number; count: number }>();

export function allowRequest(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
