## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-05-19 - Concurrent File Reading
**Learning:** Sequential `for...of` loops reading files introduce N+1 I/O overhead. When restoring configs or bulk reading items from a directory, using `Promise.all` with a `.map()` performs file reads concurrently, significantly improving performance.
**Action:** Always use `Promise.all` for independent file reads inside loops.
