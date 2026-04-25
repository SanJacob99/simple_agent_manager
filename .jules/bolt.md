## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-06-25 - Concurrent file reads on boot
**Learning:** Using sequential `for...of` loops to read files from disk introduces significant N+1 I/O overhead on server boot.
**Action:** Leverage `Promise.all` combined with `.map()` to perform file system reads and processing concurrently.
