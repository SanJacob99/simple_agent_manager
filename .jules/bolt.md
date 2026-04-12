## 2024-05-18 - ISO 8601 string sort optimization
**Learning:** ISO 8601 strings like `updatedAt` naturally sort chronologically via direct string evaluation. Using `new Date(string).getTime()` in hot loops (like sorting sessions) introduces massive overhead for no reason.
**Action:** When working with ISO 8601 timestamp arrays, compare the strings directly instead of parsing them into Date objects.
## 2024-05-19 - Chained array methods memory churn
**Learning:** In high-frequency execution paths (e.g., LLM streaming, payload processing), chained array methods like `.filter().map().join('')` or `.filter().filter().map().join('')` create multiple intermediate array allocations. This causes unnecessary memory churn and triggers garbage collection pauses.
**Action:** Replace chained array methods with single-pass `for` loops to concatenate strings or extract data directly without intermediate arrays when working in hot paths.
