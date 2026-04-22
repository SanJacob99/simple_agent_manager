# Browser Tool

> Drive a headless Chromium browser via Playwright to read and interact with live web pages.

<!-- source: src/types/nodes.ts#BrowserToolSettings -->
<!-- last-verified: 2026-04-21 -->

## Overview

The `browser` tool gives an agent a real browser it can navigate, click, type into, and scrape. One Chromium instance runs per agent workspace, keyed by the workspace `cwd`. Login cookies, localStorage, and open tabs persist across tool calls in a profile folder on disk (default: `<cwd>/.browser-profile/`), so an agent that logs into a site in one turn stays logged in on the next.

The tool is pure [Playwright](https://playwright.dev/) — no separate LLM is involved. The agent's own model drives the interaction loop: it reasons over `snapshot` (accessibility tree) or `screenshot` output, picks a selector, and calls `click`/`type`. For vision-capable models, screenshots are especially powerful because the model can see exactly what the user sees.

Always runs headless.

## Configuration

Lives under `ToolsNodeData.toolSettings.browser`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `userDataDir` | `string` | `""` | Chromium profile path. Empty = `<cwd>/.browser-profile/`. Relative paths resolve against the workspace. |
| `viewportWidth` | `integer` | `1280` | Browser viewport width in pixels. |
| `viewportHeight` | `integer` | `800` | Browser viewport height in pixels. |
| `timeoutMs` | `integer` | `30000` | Per-action timeout. Applies to navigation, clicks, fills. |
| `autoScreenshot` | `boolean` | `true` | Attach a screenshot to every state-changing action so the user sees what the agent sees. These images also enter the agent's LLM context — useful for vision-capable models, wasted bandwidth otherwise. |
| `screenshotFormat` | `'jpeg' \| 'png'` | `'jpeg'` | Inline screenshot format. JPEG is dramatically smaller; PNG is lossless. Explicit `screenshot` calls always also save a PNG to disk regardless of this setting. |
| `screenshotQuality` | `integer` | `60` | JPEG quality 1–100. Ignored for PNG. |
| `skill` | `string` | `""` | Markdown guidance injected into the system prompt. |

Properties are derived from `src/types/nodes.ts#BrowserToolSettings` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` folds the settings into top-level fields on `AgentConfig` (`browserUserDataDir`, `browserViewportWidth`, `browserViewportHeight`, `browserTimeoutMs`, `browserAutoScreenshot`, `browserScreenshotFormat`, `browserScreenshotQuality`) and injects any non-empty `skill` as a system-prompt section.

At tool construction, `server/tools/builtins/browser/browser.module.ts` returns `null` — disabling the tool — when no workspace `cwd` is configured.

The implementation lives in `server/tools/builtins/browser/browser.ts`. A module-level `Map<cwd, BrowserInstance>` holds `{ context, page, userDataDir, startedAt }`. Instances are created lazily on the first action via `chromium.launchPersistentContext(userDataDir, { headless: true, viewport })` and reused until the agent calls `action="close"` or the process exits. `AbortSignal` cancellation closes the whole context and the next tool call relaunches.

### Actions

| Action | Params | Returns |
|--------|--------|---------|
| `navigate` | `url` | New URL + page title. Auto-launches the browser. |
| `click` | `selector` | Confirmation + new URL. |
| `type` | `selector`, `text` | Confirmation. |
| `key` | `key`, `selector?` | Confirmation. |
| `text` | `selector?` | `innerText` of the selector match(es), or the whole page body when omitted. |
| `evaluate` | `expression` | JS return value as JSON. |
| `snapshot` | — | Accessibility tree as JSON. |
| `screenshot` | `fullPage?` | PNG path under `<cwd>/browser-screenshots/` + inline image. |
| `back` / `forward` / `reload` | — | Confirmation + new URL. |
| `status` | — | Running state, current URL, uptime, profile path. |
| `close` | — | Tears down the browser. Profile folder is preserved. |

Selector syntax is standard Playwright: CSS (`.cls`, `#id`, `a[href*="foo"]`), text (`text="Sign in"`), role (`role=button[name="Submit"]`). The inspection loop is typically `navigate → snapshot` (or `screenshot` for vision models) → `click`/`type` with the selector the model identified.

### Screenshot streaming

With `autoScreenshot: true`, every state-changing action (`navigate`, `click`, `type`, `key`, `back`, `forward`, `reload`) returns an `{ type: 'image', mimeType, data }` content block in addition to the usual text summary. The existing tool-result path in the chat (`src/store/session-store.ts#extractImageContent` → `msg.images` → `MessageBubble`) renders them inline without any new WebSocket event types.

Read-only actions (`text`, `evaluate`, `snapshot`, `status`, `close`) never auto-attach — they don't change the visible page. The explicit `screenshot` action always attaches regardless of the toggle.

Images cost tokens in the agent's context window. JPEG at quality 60 keeps a single 1280×800 shot at roughly 30–60 KB base64-encoded. Turn `autoScreenshot` off when using a text-only model or when cost matters more than visibility.

## Connections

The `browser` tool lives on the Tools node. It has no direct edges to other node types — it's configured inline in `ToolsNodeData.toolSettings.browser` and enabled either via the `web` group checkbox (which also enables `web_search` and `web_fetch`) or individually in the "Individual Tools" picker.

## Example

```json
{
  "toolSettings": {
    "browser": {
      "userDataDir": "",
      "viewportWidth": 1280,
      "viewportHeight": 800,
      "timeoutMs": 30000,
      "autoScreenshot": true,
      "screenshotFormat": "jpeg",
      "screenshotQuality": 60,
      "skill": "Use `snapshot` to find selectors, then `click`/`type` with them. Fall back to `screenshot` + vision when the accessibility tree is sparse (heavy JS apps, canvas-rendered UIs)."
    }
  }
}
```

A typical call sequence the agent might make:

```
browser(action="navigate", url="https://news.ycombinator.com")
browser(action="snapshot")
browser(action="click", selector="text=\"Show\"")
browser(action="text", selector=".titleline")
browser(action="close")
```
