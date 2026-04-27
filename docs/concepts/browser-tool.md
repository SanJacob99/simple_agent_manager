# Browser Tool

> Drive a Chromium browser via Playwright for user-directed web research and actions.

<!-- source: src/types/nodes.ts#BrowserToolSettings -->
<!-- last-verified: 2026-04-24 -->

## Overview

The `browser` tool gives an agent a real browser it can navigate, inspect, click, type into, scroll, and use for ordinary user-authorized web tasks. It is intended for tasks like researching a topic, comparing listings, looking for publicly posted coupons, filling reservation forms, or reading content that only appears after JavaScript runs.

One Chromium instance runs per agent workspace, keyed by the workspace `cwd`. Login cookies, localStorage, open tabs, and page state persist across calls in a profile folder on disk (default: `<cwd>/.browser-profile/`), so a user can authenticate in the browser and the agent can continue from that authorized session.

The tool is pure [Playwright](https://playwright.dev/). The agent's own model drives the interaction loop: it reasons over `observe`, `snapshot`, or `screenshot` output, chooses a selector, and calls actions such as `click`, `type`, `select`, `check`, or `scroll`. For vision-capable models, screenshots are especially useful because the model can see the same page state the user sees.

Runs in a visible (headful) window by default so the user can take over login, CAPTCHA, payment, or consent steps directly. If the environment has no display (remote server, CI, locked-down session) the tool automatically falls back to headless. Set `headless: true` to force headless even when a display is available.

## Configuration

Lives under `ToolsNodeData.toolSettings.browser`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `userDataDir` | `string` | `""` | Chromium profile path. Empty = `<cwd>/.browser-profile/`. Relative paths resolve against the workspace. |
| `headless` | `boolean` | `false` | When `false` (default), open a visible Chromium window; the tool automatically falls back to headless if launching headful fails (no display). Set to `true` to force headless. |
| `viewportWidth` | `integer` | `1280` | Browser viewport width in pixels. |
| `viewportHeight` | `integer` | `800` | Browser viewport height in pixels. |
| `timeoutMs` | `integer` | `30000` | Per-action timeout. Applies to navigation, clicks, fills, waits, and selectors. |
| `autoScreenshot` | `boolean` | `true` | Attach a screenshot to every state-changing action so the user sees what the agent sees. These images also enter the agent's LLM context, useful for vision-capable models and wasted bandwidth otherwise. |
| `screenshotFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Inline screenshot format. JPEG is dramatically smaller; PNG is lossless. Explicit `screenshot` calls always also save a PNG to disk regardless of this setting. |
| `screenshotQuality` | `integer` | `60` | JPEG quality 1-100. Ignored for PNG. |
| `stealth` | `boolean` | `true` | Apply `puppeteer-extra-plugin-stealth` on launch to hide common automation signals (`navigator.webdriver`, plugin arrays, WebGL vendor, `HeadlessChrome` UA). Does **not** defeat TLS/JA3 fingerprinting, IP reputation, or behavioral analysis. The underlying library has been unmaintained since 2023. |
| `locale` | `string` | `""` | BCP-47 locale passed to the context and to the `Accept-Language` header. Empty = `en-US`. |
| `timezone` | `string` | `""` | IANA timezone name (e.g. `America/New_York`). Empty = host's resolved timezone via `Intl.DateTimeFormat`. |
| `userAgent` | `string` | `""` | Override the outbound User-Agent. Empty = Playwright/stealth default. Override only when a specific site demands a specific UA. |
| `cdpEndpoint` | `string` | `""` | CDP URL (e.g. `http://127.0.0.1:9222`). When set, the tool attaches to a Chrome the user launched with `--remote-debugging-port=9222` and drives an isolated context inside it — best fingerprint, best defense against bot protection. Unreachable endpoints fall back to the normal launch path. |
| `skill` | `string` | `""` | Markdown guidance injected into the system prompt. |

Properties are derived from `src/types/nodes.ts#BrowserToolSettings` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` folds the settings into top-level fields on `AgentConfig` (`browserUserDataDir`, `browserHeadless`, `browserViewportWidth`, `browserViewportHeight`, `browserTimeoutMs`, `browserAutoScreenshot`, `browserScreenshotFormat`, `browserScreenshotQuality`, `browserStealth`, `browserLocale`, `browserTimezone`, `browserUserAgent`, `browserCdpEndpoint`) and injects any non-empty `skill` as a system-prompt section.

At tool construction, `server/tools/builtins/browser/browser.module.ts` returns `null`, disabling the tool, when no workspace `cwd` is configured.

The implementation lives in `server/tools/builtins/browser/browser.ts`. A module-level `Map<cwd, BrowserInstance>` holds `{ context, page, userDataDir, headless, startedAt }`. Instances are created lazily on the first action via `chromium.launchPersistentContext(userDataDir, { headless, viewport })` and reused until the agent calls `action="close"` or the process exits. `AbortSignal` cancellation closes the whole context and the next tool call relaunches.

When the resolved setting is `headless: false`, launch is attempted headful first; if Playwright throws (e.g., no display available), the tool logs a warning and retries with `headless: true`. The instance's `headless` flag reflects what actually launched, so `status` and the per-page `Browser running` summary show the real mode. `headless: true` is always respected without a retry.

Each Playwright context also registers an `addInitScript` that shims `window.__name = (fn) => fn`. The server runs via `tsx`, which wraps named functions in `__name(fn, "name")` at bundle time; without the shim, `page.evaluate` callbacks that contain named inner helpers (notably `observe`) throw `ReferenceError: __name is not defined` in the page context.

### Stealth & emulation

`getOrLaunch` applies `puppeteer-extra-plugin-stealth` via `playwright-extra` when `stealth` is on (default). The plugin patches `navigator.webdriver`, the Chromium plugin/MIME-type arrays, WebGL vendor/renderer strings, permission queries, and the `HeadlessChrome` UA substring. That handles most entry-level bot detections. It does **not** defeat TLS/JA3 fingerprinting, IP reputation checks, or behavioral analysis — when a site still blocks after stealth, route around via `search` or `handover` rather than escalating stealth.

The Playwright context launches with a resolved locale (`en-US` default), timezone (host system via `Intl.DateTimeFormat` default), and `Accept-Language` header. The `userAgent` is left to Playwright/stealth unless explicitly overridden.

### Confirmation gating (HITL)

The tool is classified `read-only` at the module level even though many of its actions mutate state. Classifying the whole tool as `state-mutating` would make the system prompt require a separate `confirm_action` turn before every call — including `observe` and `search`, which is too coarse and creates confirmation fatigue.

Instead, the tool itself gates inside `execute`. Each action is labelled either `read-only` or `state-mutating` in `BROWSER_ACTION_CLASSIFICATION`:

- Read-only (no gate): `navigate`, `search`, `observe`, `text`, `snapshot`, `screenshot`, `scroll`, `wait`, `status`, `list_tabs`, `back`, `forward`, `reload`.
- Gated: `click`, `type`, `key`, `select`, `check`, `evaluate`, `new_tab`, `switch_tab`, `close_tab`, `close`, `handover`.

For a gated action, `gateIfWriting` calls `HitlRegistry.register({ kind: 'confirm', question, ... })` with a targeted question naming the action and target — e.g. ``Browser: click `role=button[name="Buy"]` on https://store.example.com/checkout?`` — then emits `hitl:input_required`, blocks until the user answers via the `HitlBanner`, emits `hitl:resolved`, and only runs the underlying Playwright call on `'yes'`. A `'no'` or timeout short-circuits to a structured "not approved" tool result so the model can re-plan instead of looping on the same call.

When the tool context does not carry a HITL registry (tests, headless runs without HITL wiring), the gate is a no-op — actions proceed immediately.

### `handover` — explicit user takeover

`browser(action="handover", reason="captcha" | "login" | "2fa" | "payment" | "other", instructions?, timeoutSeconds?)` is the escape hatch when stealth or `search` rotation isn't enough. It:

1. Verifies the browser is already launched and visible (throws if headless — auto-flipping mid-session is not supported yet).
2. Gates through `HitlRegistry` with a rich question that tells the user what to do in the already-open Chrome window (e.g. "Browser needs you to take over (captcha) at https://example.com. Solve the Turnstile. Do the step in the Chrome window, then answer yes to resume, or no to decline.").
3. On `'yes'`, runs an internal observe + screenshot and returns the post-handover page state so the model immediately sees what the user did.
4. On `'no'` / timeout, returns the declined result; the agent should try a different approach rather than re-calling `handover`.

### Operator Policy

The browser tool is for user-directed browsing and action, not stealth scraping or access-control bypass. The tool description and bundled browser skill instruct the agent to:

- never bypass CAPTCHA, bot protection, paywalls, or access controls, but treat an encountered block as a signal to switch sources rather than to stop
- when blocked, run the retry playbook: `search` auto-rotates engines; then try topical aggregators (Groupon, Yelp, RetailMeNot, TripAdvisor, Wikipedia, Reddit, brand sites); then fall back to `web_search`/`web_fetch`; if the task genuinely needs the blocked site, call `handover` so the user can finish the human step in the visible Chrome window; only escalate to `ask_user` once the playbook is exhausted
- not pre-emit `confirm_action`; the browser tool gates itself at call time for committing actions
- hand off passwords, one-time codes, payment card data, and other secrets to the user in the browser, using visible-browser mode when needed
- try publicly displayed coupon codes only, without brute-force guessing or large automated attempts

The runtime appends "Browser notices" when the visible page text suggests bot protection, login, payment, or commitment steps. The bot-protection notice now names the `search` action and the rest of the playbook inline so the agent sees the next step alongside the block signal.

### Actions

| Action | Params | Returns |
|--------|--------|---------|
| `navigate` | `url` | New URL + page title. Auto-launches the browser. |
| `search` | `query`, `engine?` | SERP text + list of engines tried. Rotates through DuckDuckGo (HTML), Bing, Brave, Startpage, and Ecosia in order, skipping any that show bot-protection signals, until one succeeds or all fail. `engine` moves a preferred engine to the front. |
| `observe` | - | Current URL, title, visible text excerpt, and interactive elements with suggested selectors. |
| `click` | `selector` | Confirmation + new URL. |
| `type` | `selector`, `text` | Confirmation. |
| `key` | `key`, `selector?` | Confirmation. |
| `select` | `selector`, `value?`, `label?` | Selected option value(s). |
| `check` | `selector`, `checked?` | Checkbox/radio confirmation. `checked` defaults to `true`. |
| `scroll` | `direction?`, `amount?`, `x?`, `y?` | Scroll confirmation + screenshot when enabled. |
| `wait` | `selector?`, `loadState?`, `timeoutMs?` | Selector or load-state wait confirmation. |
| `text` | `selector?` | `innerText` of the selector match(es), or the whole page body when omitted. |
| `evaluate` | `expression` | JS return value as JSON. |
| `snapshot` | - | Accessibility tree as JSON. |
| `screenshot` | `fullPage?` | PNG path under `<cwd>/browser-screenshots/` + inline image. |
| `back` / `forward` / `reload` | - | Confirmation + new URL. |
| `list_tabs` | - | Open tab indexes, URLs, titles, and active marker. |
| `new_tab` | `url?` | Opens a tab, optionally navigates it, and makes it active. |
| `switch_tab` | `index` | Makes the indexed tab active. |
| `close_tab` | `index?` | Closes the indexed tab, or the active tab when omitted. |
| `status` | - | Running state, current URL, uptime, profile path. |
| `close` | - | Tears down the browser. Profile folder is preserved. |
| `handover` | `reason`, `instructions?`, `timeoutSeconds?` | Pauses the run and asks the user to finish a human step (CAPTCHA, login, 2FA, payment) in the visible Chrome window, then returns the post-handover page state. Requires `headless: false`. |

Selector syntax is standard Playwright: CSS (`.cls`, `#id`, `a[href*="foo"]`), text (`text="Sign in"`), role (`role=button[name="Submit"]`). The inspection loop is typically `navigate -> observe` (or `screenshot` for vision models) -> `click`/`type`/`select`/`check` with the selector the model identified.

### Screenshot streaming

With `autoScreenshot: true`, every state-changing action (`navigate`, `click`, `type`, `key`, `select`, `check`, `scroll`, `back`, `forward`, `reload`, `new_tab`, `switch_tab`, `close_tab`) returns an `{ type: 'image', mimeType, data }` content block in addition to the usual text summary. The existing tool-result path in the chat (`src/store/session-store.ts#extractImageContent` -> `msg.images` -> `MessageBubble`) renders them inline without any new WebSocket event types.

Read-only actions (`observe`, `text`, `evaluate`, `snapshot`, `wait`, `list_tabs`, `status`, `close`) never auto-attach. The explicit `screenshot` action always attaches regardless of the toggle.

Images cost tokens in the agent's context window. JPEG at quality 60 keeps a single 1280x800 shot at roughly 30-60 KB base64-encoded. Turn `autoScreenshot` off when using a text-only model or when cost matters more than visibility.

## Attach to your own Chrome (CDP)

When stealth + `search` rotation + `handover` can't get through (advanced TLS/JA3 fingerprinting, IP reputation, strict aggregate scoring), the escape hatch is to attach the tool to a Chrome instance you launched yourself. Your real Chrome has a real TLS handshake, a real IP reputation, your real cookies, and your installed extensions — no amount of JS-level stealth will match that.

**Setup.** Launch Chrome with remote debugging before enabling the setting:

- Windows: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222`
- macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
- Linux: `google-chrome --remote-debugging-port=9222`

Then set `cdpEndpoint` to `http://127.0.0.1:9222` (or whatever port you used) in the browser tool settings.

**Behavior.** `getOrLaunch` calls `chromium.connectOverCDP(cdpEndpoint, { timeout })`, then inspects `browser.contexts()`:

- If an existing context is present (the common case — Chrome's default profile), the tool **reuses it**. Agent tabs open as new tabs inside the Chrome window you're already looking at, with the user's cookies/storage/extensions visible to the agent. The tool tracks which pages it opened (`ourPages` on the `BrowserInstance`) and only ever acts on those, so `list_tabs` / `switch_tab` / `close_tab` never leak or touch the user's personal tabs.
- If no context exists, the tool creates one via `browser.newContext(contextOptions)`. The `locale`, `timezoneId`, `extraHTTPHeaders`, and optional `userAgent` options only apply on this path — Playwright can't retrofit them onto an existing context.

The `__name` init-script shim is installed on whichever context we end up using.

**Fallback.** If the CDP connect fails (wrong port, Chrome not launched with the flag, firewall), the tool logs a warning and falls through to the normal `launchPersistentContext` path — the agent keeps working rather than erroring out.

**Close semantics.** `teardownInstance(inst)` branches on the `ownsContext` flag: when the tool created the context (persistent launch or the no-existing-contexts CDP fallback) it calls `context.close()`; when the tool attached to a shared user context it closes only the pages it opened (`ourPages`), leaving the user's tabs alone. `browser.close()` is never called on a CDP-attached browser — that would shut down the user's entire Chrome instance. The CDP websocket is dropped when the `BrowserInstance` is evicted and GC'd.

**Stealth + CDP.** `stealth` is only wired into Playwright's `launch`/`launchPersistentContext` path — it's a no-op when we go the CDP route. That's intentional: your real Chrome has genuine fingerprints, so masking them would be counterproductive.

**Handover.** `action="handover"` requires a visible browser. A CDP-attached Chrome is always visible (you launched it), so handover works identically to the persistent-context path.

The `browser` tool lives on the Tools node. It has no direct edges to other node types. It is configured inline in `ToolsNodeData.toolSettings.browser` and enabled either via the `web` group checkbox, which also enables `web_search` and `web_fetch`, or individually in the "Individual Tools" picker.

## Example

```json
{
  "toolSettings": {
    "browser": {
      "userDataDir": "",
      "headless": false,
      "viewportWidth": 1280,
      "viewportHeight": 800,
      "timeoutMs": 30000,
      "autoScreenshot": true,
      "screenshotFormat": "jpeg",
      "screenshotQuality": 60,
      "stealth": true,
      "locale": "",
      "timezone": "",
      "userAgent": "",
      "skill": "Use observe to find selectors, then click/type/select/check. When a page is bot-blocked, prefer action=\"search\" over manual SERP URLs; if a task needs the specific blocked site, call action=\"handover\" so the user can finish the human step in the visible Chrome window."
    }
  }
}
```

A typical call sequence the agent might make:

```text
browser(action="search", query="italian restaurant near me reservation")
browser(action="click", selector="text=\"Reserve a table\"")
// tool pops an HITL banner: "Browser: click `text=\"Reserve a table\"` on https://example.com?" — user clicks Yes.
browser(action="select", selector="select[name=\"partySize\"]", value="2")
browser(action="type", selector="input[name=\"time\"]", text="10:00 PM")
browser(action="click", selector="role=button[name=\"Confirm reservation\"]")
// banner: "Browser: click `role=button[name=\"Confirm reservation\"]` on https://example.com/checkout?" — user reviews + clicks Yes.
```
