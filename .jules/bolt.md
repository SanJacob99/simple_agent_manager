## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2026-04-21 - Concurrent agent initialization
**Learning:** Booting many agents using a sequential for...await loop introduces N+1 I/O latency, delaying server readiness.
**Action:** When initializing multiple independent entities from disk, use Promise.all combined with .map to perform I/O operations concurrently.
