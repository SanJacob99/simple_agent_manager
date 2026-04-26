## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.
## 2024-05-19 - [Agent Config Restoration Optimization]
**Learning:** Sequential disk I/O when restoring many agent configurations (`for...of` loop with `fs.readdir` and `fs.readFile`) during server startup can lead to N+1 overhead and noticeable delays.
**Action:** Replaced sequential file reads with chunked `Promise.all` execution to process multiple files concurrently while avoiding OS-level `EMFILE` limits for massive directories.
