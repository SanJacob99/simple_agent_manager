import { defineTool } from '../../tool-module';
import { createBrowserTool, type BrowserToolContext } from './browser';
import type { AskUserContext } from '../human/ask-user';

/**
 * Browser - Chromium driven by Playwright.
 * One browser per agent workspace; persistent profile survives across runs.
 * Returns null when no workspace directory is configured.
 *
 * Classification is `read-only` even though many actions mutate state: the
 * browser tool gates itself via the HITL registry for committing actions
 * (click/type/select/check/handover/...) — see the per-action table in
 * `browser.ts`. Classifying as `state-mutating` at the module level would
 * make the system prompt force a `confirm_action` turn before every call,
 * which is too coarse (it would gate `observe` and `search` too).
 */
export default defineTool<BrowserToolContext & { enabled: boolean; hitl?: AskUserContext }>({
  name: 'browser',
  label: 'Browser',
  description:
    'Drive a real Chromium browser for user-directed web research and actions, with approval gates',
  group: 'web',
  icon: 'globe',
  classification: 'read-only',

  resolveContext: (config, runtime) => {
    const cwd = runtime.cwd ?? '';
    const rawFormat = config.browserScreenshotFormat;
    return {
      enabled: Boolean(cwd),
      cwd,
      userDataDir: config.browserUserDataDir?.trim() ?? '',
      headless: config.browserHeadless ?? false,
      viewportWidth: config.browserViewportWidth ?? 1280,
      viewportHeight: config.browserViewportHeight ?? 800,
      defaultTimeoutMs: config.browserTimeoutMs ?? 30_000,
      autoScreenshot: config.browserAutoScreenshot ?? true,
      screenshotFormat: rawFormat === 'png' ? 'png' : 'jpeg',
      screenshotQuality: config.browserScreenshotQuality ?? 60,
      stealth: config.browserStealth ?? true,
      locale: config.browserLocale?.trim() ?? '',
      timezone: config.browserTimezone?.trim() ?? '',
      userAgent: config.browserUserAgent?.trim() ?? '',
      cdpEndpoint: config.browserCdpEndpoint?.trim() ?? '',
      hitl: runtime.hitl,
    };
  },

  create: (ctx) => {
    if (!ctx.enabled) return null;
    return createBrowserTool({
      cwd: ctx.cwd,
      userDataDir: ctx.userDataDir,
      headless: ctx.headless,
      viewportWidth: ctx.viewportWidth,
      viewportHeight: ctx.viewportHeight,
      defaultTimeoutMs: ctx.defaultTimeoutMs,
      autoScreenshot: ctx.autoScreenshot,
      screenshotFormat: ctx.screenshotFormat,
      screenshotQuality: ctx.screenshotQuality,
      stealth: ctx.stealth,
      locale: ctx.locale,
      timezone: ctx.timezone,
      userAgent: ctx.userAgent,
      cdpEndpoint: ctx.cdpEndpoint,
      hitl: ctx.hitl,
    });
  },
});
