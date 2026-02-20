// Shared in-memory cache for availability data.
// Placing it in a separate module lets the book route invalidate it
// after a successful write, preventing stale 60s responses.

interface CacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  ts: number
}

export const availabilityCache = new Map<string, CacheEntry>()
export const CACHE_TTL = 60_000
