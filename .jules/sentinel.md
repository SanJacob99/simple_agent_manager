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

## 2026-04-10 - [CRITICAL] Fix DoS vulnerability in Webhook Handler signature validation
**Vulnerability:** The WebhookHandler used `crypto.timingSafeEqual` directly on user-provided signatures without checking their byte lengths, causing a RangeError crash when the lengths mismatched, leading to a Denial of Service (DoS) vulnerability.
**Learning:** `crypto.timingSafeEqual` throws a `RangeError` if the two buffers passed to it are of different sizes. Passing unverified inputs directly to this function can crash the node process.
**Prevention:** Always compare the `.byteLength` property of both Buffers before passing them to `crypto.timingSafeEqual`.

## 2026-04-11 - [CRITICAL] Fix Multiple-A-Record SSRF bypass in web_fetch tool
**Vulnerability:** The `web_fetch` tool used `dns.promises.lookup` to validate hostnames against an IP blocklist, but did not pass the `{ all: true }` flag. Attackers could bypass the filter by supplying a domain that resolves to two A records (e.g. one safe IP, one restricted IP).
**Learning:** Node's `dns.lookup` returns only the first resolved address by default. If multiple records exist, an attacker can pass the check but still potentially connect to an internal IP. Additionally, modifying `url.hostname` to the resolved IP to mitigate DNS rebinding breaks TLS SNI validation.
**Prevention:** Always use `{ all: true }` in `dns.lookup` to ensure all resolved IPs are validated against blocklists. Full DNS rebinding protection requires a custom HTTP Agent/dispatcher rather than overriding the URL hostname.

## 2026-04-26 - [CRITICAL] Fix prefix-matching path traversal bypass in file system tools
**Vulnerability:** The path traversal prevention logic in file system tools (`write-file.ts`, `read-file.ts`, etc) used `!resolved.startsWith(ctx.cwd)`, which is vulnerable to partial directory name bypasses (e.g., escaping `/workspace` via `../workspace-secrets/passwd`).
**Learning:** Checking directory boundaries with `startsWith` using the directory path string alone is insufficient and insecure because it allows prefix matches.
**Prevention:** Always append a trailing directory separator (`path.sep`) to the base directory before using `startsWith`, or verify an exact match when testing for path boundaries.

## 2026-04-26 - [CRITICAL] Fix prefix-matching path traversal bypass in file system tools
**Vulnerability:** The path traversal prevention logic in file system tools (`write-file.ts`, `read-file.ts`, etc) used `!resolved.startsWith(ctx.cwd)`, which is vulnerable to partial directory name bypasses (e.g., escaping `/workspace` via `../workspace-secrets/passwd`).
**Learning:** Checking directory boundaries with `startsWith` using the directory path string alone is insufficient and insecure because it allows prefix matches.
**Prevention:** Always append a trailing directory separator (`path.sep`) to the base directory before using `startsWith`, or verify an exact match when testing for path boundaries.
