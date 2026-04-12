## 2026-04-07 - [CRITICAL] Fix RCE vulnerability in calculator tool
**Vulnerability:** The calculator tool evaluated arbitrary mathematical expressions using `new Function()` without validating the input, leading to a critical Remote Code Execution (RCE) vulnerability.
**Learning:** Hardcoded evaluations or use of `eval`/`new Function` must strictly validate inputs using whitelisting. Otherwise they open up server-side code execution vulnerabilities. The unescaped `/` in a regex string caused syntax errors; proper escaping `\/` is required inside character classes in regex strings.
**Prevention:** Always validate all user input prior to evaluating them.

## 2026-04-08 - [CRITICAL] Fix SSRF vulnerability in web_fetch tool
**Vulnerability:** The `web_fetch` tool passed user-provided URLs directly to the `fetch` function without validating the protocol or hostname, exposing a Server-Side Request Forgery (SSRF) vulnerability. This allowed agents or malicious inputs to access internal services and restricted metadata endpoints like `169.254.169.254`.
**Learning:** Tools that make external network requests on behalf of the user must explicitly block local, internal, and reserved IP addresses, as well as enforcing standard protocols (HTTP/HTTPS) to avoid probing internal infrastructure.
**Prevention:** Always parse and validate target URLs before sending server-side requests. Apply explicit deny-lists for sensitive domains and IPs.

## 2026-04-09 - [CRITICAL] Fix path traversal in StorageEngine
**Vulnerability:** The StorageEngine improperly joined base directories with user-supplied inputs such as `agentName`, `date`, and `sessionId` without validation, allowing attackers to read/write arbitrary files via inputs like `../../../etc/passwd`.
**Learning:** `path.join` natively accepts `..` navigation, meaning an attacker-supplied string can escape intended boundaries.
**Prevention:** Never use bare `path.join` on untrusted inputs. Always resolve absolute paths and enforce prefix boundary checks (e.g. `!resolvedTarget.startsWith(resolvedBase + path.sep)`) to confirm the target path exists strictly inside the base directory.

## 2026-04-10 - [CRITICAL] Fix DoS vulnerability in timingSafeEqual comparison
**Vulnerability:** The webhook signature validation used `crypto.timingSafeEqual` after only verifying the string lengths matched (`signature.length !== expected.length`). If a signature had the correct string length but incorrect byte length (e.g., using multi-byte characters), `timingSafeEqual` would throw a `RangeError`, leading to a Denial of Service (DoS) crash.
**Learning:** Node's `crypto.timingSafeEqual` requires the `Buffer` instances passed to it to have the exact same byte length. Comparing string lengths is insufficient because strings can contain multi-byte characters.
**Prevention:** Always compare the `byteLength` property of the instantiated `Buffer` objects prior to calling `crypto.timingSafeEqual`.
