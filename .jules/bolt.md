## 2024-05-11 - JSONL File Tailing Optimization
**Learning:** In `channel-session-store.ts`, using `.split('\n')` on a potentially large JSONL file transcript to tail the last few lines results in massive intermediate string array allocations. This causes unnecessary garbage collection pressure and memory bloat, especially as the app operates on many agent communication logs.
**Action:** Always use a backward search loop with `lastIndexOf('\n')` to extract only the needed lines directly from the raw string without splitting the entire file into memory.
