## 2026-04-07 - [CRITICAL] Fix RCE vulnerability in calculator tool
**Vulnerability:** The calculator tool evaluated arbitrary mathematical expressions using `new Function()` without validating the input, leading to a critical Remote Code Execution (RCE) vulnerability.
**Learning:** Hardcoded evaluations or use of `eval`/`new Function` must strictly validate inputs using whitelisting. Otherwise they open up server-side code execution vulnerabilities. The unescaped `/` in a regex string caused syntax errors; proper escaping `\/` is required inside character classes in regex strings.
**Prevention:** Always validate all user input prior to evaluating them.
