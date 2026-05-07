## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-05-18 - Avoid chained array methods in hot paths
**Learning:** Chained array methods like .filter().map().join() create intermediate arrays that cause memory churn and GC pauses in high-frequency paths.
**Action:** Use single-pass for loops instead of chained array methods for critical text extraction code paths.

## 2024-05-19 - Agent Config Restoration Optimization
**Learning:** Sequential disk I/O when restoring many agent configurations (`for...of` loop with `fs.readdir` and `fs.readFile`) during server startup can lead to N+1 overhead and noticeable delays.
**Action:** Replaced sequential file reads with chunked `Promise.all` execution to process multiple files concurrently while avoiding OS-level `EMFILE` limits for massive directories.

## 2026-04-23 - Concurrent File I/O Optimization
**Learning:** Using sequential `for...of` loops with `await fs.stat` (or similar file system reads) in hot paths like calculating directory sizes introduces significant N+1 I/O overhead. Node.js can handle these concurrently.
**Action:** When performing independent file system operations on a list of files (like fetching stats or reading contents), use `Promise.all()` mapped over the array to execute them concurrently.
## 2024-05-18 - Safe Concurrent Bulk File Cleanup
**Learning:** Running unbounded `Promise.all` loops for concurrent file system I/O over arrays of paths (e.g., in `removeOrphanTranscripts`) accelerates disk operations but causes application-crashing `EMFILE` (too many open files) limits when the directory grows.
**Action:** Batch concurrent file operations using a chunked execution pattern (e.g., `CHUNK_SIZE = 50`) to gain the speed of concurrency without triggering OS-level file descriptor limits.

## 2024-05-18 - JSONL Parsing Optimization
**Learning:** Parsing massive JSONL files using `split('\n')` creates enormous intermediate arrays of strings, which causes significant memory churn and forces expensive garbage collection pauses.
**Action:** Use a single-pass `while` loop with `indexOf('\n')` and `substring()` to extract strings from the raw file content one line at a time, avoiding large intermediate array allocations completely.
