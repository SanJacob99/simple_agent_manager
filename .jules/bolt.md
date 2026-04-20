## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.

## 2024-05-14 - Concurrent I/O During Agent Restore
**Learning:** In `server/agents/agent-manager.ts`, using a sequential `for...of` loop to read and restore agent configuration files (`agent-config.json`) causes an N+1 I/O bottleneck as the number of agents scales up.
**Action:** Replaced the sequential loop with `Promise.all` and `entries.map(...)` to issue concurrent reads. This reduced the time to restore 1000 agents from ~648ms to ~163ms.
