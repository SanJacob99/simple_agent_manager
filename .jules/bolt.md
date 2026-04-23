## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-05-18 - Avoid chained array methods in hot paths
**Learning:** Chained array methods like .filter().map().join() create intermediate arrays that cause memory churn and GC pauses in high-frequency paths.
**Action:** Use single-pass for loops instead of chained array methods for critical text extraction code paths.

## 2026-04-23 - Concurrent File I/O Optimization
**Learning:** Using sequential `for...of` loops with `await fs.stat` (or similar file system reads) in hot paths like calculating directory sizes introduces significant N+1 I/O overhead. Node.js can handle these concurrently.
**Action:** When performing independent file system operations on a list of files (like fetching stats or reading contents), use `Promise.all()` mapped over the array to execute them concurrently.
