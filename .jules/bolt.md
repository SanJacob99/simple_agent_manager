## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-05-18 - Concurrent File Read Optimization
**Learning:** Sequential `for...of` loops reading massive numbers of small configuration files from disk (e.g. agent configs on server boot) introduce severe N+1 I/O overhead. This causes noticeable startup delays when the codebase scales.
**Action:** For performance optimization when reading multiple files from disk (e.g. restoring configs or bulk reads from directories), always leverage `Promise.all` combined with `.map()` to perform file system reads and processing concurrently, eliminating the N+1 I/O overhead of sequential loops.
