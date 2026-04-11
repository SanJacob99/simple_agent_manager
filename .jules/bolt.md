## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2026-04-11 - Array methods overhead in LLM streaming
**Learning:** During high-frequency LLM streaming, chained array methods (`.filter().map().join('')`) allocate intermediate arrays on every chunk, causing significant memory churn and garbage collection pauses.
**Action:** When parsing LLM text chunks rapidly in stream-transforms or the coordinator, use single-pass `for...of` loops and accumulate strings directly instead of chaining array operations.
