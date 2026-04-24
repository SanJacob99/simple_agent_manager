# Browser Tool

> Drive a Chromium browser via Playwright for user-directed web research and actions.

<!-- source: src/types/nodes.ts#BrowserToolSettings -->
<!-- last-verified: 2026-04-24 -->

## Overview

The `browser` tool gives an agent a real browser it can navigate, inspect, click, type into, scroll, and use for ordinary user-authorized web tasks. It is intended for tasks like researching a topic, comparing listings, looking for publicly posted coupons, filling reservation forms, or reading content that only appears after JavaScript runs.

One Chromium instance runs per agent workspace, keyed by the workspace `cwd`. Login cookies, localStorage, open tabs, and page state persist across calls in a profile folder on disk (default: `<cwd>/.browser-profile/`), so a user can authenticate in the browser and the agent can continue from that authorized session.

The tool is pure [Playwright](https://playwright.dev/). The agent's own model drives the interaction loop: it reasons over `observe`, `snapshot`, or `screenshot` output, chooses a selector, and calls actions such as `click`, `type`, `select`, `check`, or `scroll`. For vision-capable models, screenshots are especially useful because the model can see the same page state the user sees.

Runs headless by default. Disable `headless` in the tool settings when the user needs to take over protected login, CAPTCHA, payment, or consent steps in a visible browser window.

## Configuration

Lives under `ToolsNodeData.toolSettings.browser`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `userDataDir` | `string` | `""` | Chromium profile path. Empty = `<cwd>/.browser-profile/`. Relative paths resolve against the workspace. |
| `headless` | `boolean` | `true` | Run Chromium without a visible browser window. Turn off when the user needs to take over protected login, CAPTCHA, payment, or consent steps. |
| `viewportWidth` | `integer` | `1280` | Browser viewport width in pixels. |
| `viewportHeight` | `integer` | `800` | Browser viewport height in pixels. |
| `timeoutMs` | `integer` | `30000` | Per-action timeout. Applies to navigation, clicks, fills, waits, and selectors. |
| `autoScreenshot` | `boolean` | `true` | Attach a screenshot to every state-changing action so the user sees what the agent sees. These images also enter the agent's LLM context, useful for vision-capable models and wasted bandwidth otherwise. |
| `screenshotFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Inline screenshot format. JPEG is dramatically smaller; PNG is lossless. Explicit `screenshot` calls always also save a PNG to disk regardless of this setting. |
| `screenshotQuality` | `integer` | `60` | JPEG quality 1-100. Ignored for PNG. |
| `skill` | `string` | `""` | Markdown guidance injected into the system prompt. |

Properties are derived from `src/types/nodes.ts#BrowserToolSettings` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` folds the settings into top-level fields on `AgentConfig` (`browserUserDataDir`, `browserHeadless`, `browserViewportWidth`, `browserViewportHeight`, `browserTimeoutMs`, `browserAutoScreenshot`, `browserScreenshotFormat`, `browserScreenshotQuality`) and injects any non-empty `skill` as a system-prompt section.

At tool construction, `server/tools/builtins/browser/browser.module.ts` returns `null`, disabling the tool, when no workspace `cwd` is configured.

The implementation lives in `server/tools/builtins/browser/browser.ts`. A module-level `Map<cwd, BrowserInstance>` holds `{ context, page, userDataDir, headless, startedAt }`. Instances are created lazily on the first action via `chromium.launchPersistentContext(userDataDir, { headless, viewport })` and reused until the agent calls `action="close"` or the process exits. `AbortSignal` cancellation closes the whole context and the next tool call relaunches.

### Operator Policy

The browser tool is for user-directed browsing and action, not stealth scraping or access-control bypass. The tool description and bundled browser skill instruct the agent to:

- stop at CAPTCHA, bot protection, paywalls, and access controls instead of bypassing them
- hand off passwords, one-time codes, payment card data, and other secrets to the user in the browser, using visible-browser mode when needed
- use `confirm_action` before final submissions that commit the user, such as reservations, purchases, payments, messages, appointments, cancellations, or account changes
- try publicly displayed coupon codes only, without brute-force guessing or large automated attempts

The runtime also appends "Browser notices" when the visible page text suggests bot protection, login, payment, or commitment steps.

### Actions

| Action | Params | Returns |
|--------|--------|---------|
| `navigate` | `url` | New URL + page title. Auto-launches the browser. |
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

Selector syntax is standard Playwright: CSS (`.cls`, `#id`, `a[href*="foo"]`), text (`text="Sign in"`), role (`role=button[name="Submit"]`). The inspection loop is typically `navigate -> observe` (or `screenshot` for vision models) -> `click`/`type`/`select`/`check` with the selector the model identified.

### Screenshot streaming

With `autoScreenshot: true`, every state-changing action (`navigate`, `click`, `type`, `key`, `select`, `check`, `scroll`, `back`, `forward`, `reload`, `new_tab`, `switch_tab`, `close_tab`) returns an `{ type: 'image', mimeType, data }` content block in addition to the usual text summary. The existing tool-result path in the chat (`src/store/session-store.ts#extractImageContent` -> `msg.images` -> `MessageBubble`) renders them inline without any new WebSocket event types.

Read-only actions (`observe`, `text`, `evaluate`, `snapshot`, `wait`, `list_tabs`, `status`, `close`) never auto-attach. The explicit `screenshot` action always attaches regardless of the toggle.

Images cost tokens in the agent's context window. JPEG at quality 60 keeps a single 1280x800 shot at roughly 30-60 KB base64-encoded. Turn `autoScreenshot` off when using a text-only model or when cost matters more than visibility.

## Connections

The `browser` tool lives on the Tools node. It has no direct edges to other node types. It is configured inline in `ToolsNodeData.toolSettings.browser` and enabled either via the `web` group checkbox, which also enables `web_search` and `web_fetch`, or individually in the "Individual Tools" picker.

## Example

```json
{
  "toolSettings": {
    "browser": {
      "userDataDir": "",
      "headless": true,
      "viewportWidth": 1280,
      "viewportHeight": 800,
      "timeoutMs": 30000,
      "autoScreenshot": true,
      "screenshotFormat": "jpeg",
      "screenshotQuality": 60,
      "skill": "Use observe to find selectors, then click/type/select/check with them. Stop at CAPTCHA or payment/login handoff steps. Use confirm_action before final commitments."
    }
  }
}
```

A typical call sequence the agent might make:

```text
browser(action="navigate", url="https://www.google.com/search?q=italian+restaurant+near+me+reservation")
browser(action="observe")
browser(action="click", selector="text=\"Reserve a table\"")
browser(action="select", selector="select[name=\"partySize\"]", value="2")
browser(action="type", selector="input[name=\"time\"]", text="10:00 PM")
confirm_action(question="Reserve a table for two at Example Italian tonight at 10:00 PM - proceed?")
browser(action="click", selector="role=button[name=\"Confirm reservation\"]")
```
