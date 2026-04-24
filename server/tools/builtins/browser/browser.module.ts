import { defineTool } from '../../tool-module';
import { createBrowserTool, type BrowserToolContext } from './browser';

/**
 * Browser - Chromium driven by Playwright.
 * One browser per agent workspace; persistent profile survives across runs.
 * Returns null when no workspace directory is configured.
 */
export default defineTool<BrowserToolContext & { enabled: boolean }>({
  name: 'browser',
  label: 'Browser',
  description:
    'Drive a real Chromium browser for user-directed web research and actions, with approval gates',
  group: 'web',
  icon: 'globe',
  classification: 'state-mutating',

  resolveContext: (config, runtime) => {
    const cwd = runtime.cwd ?? '';
    const rawFormat = config.browserScreenshotFormat;
    return {
      enabled: Boolean(cwd),
      cwd,
      userDataDir: config.browserUserDataDir?.trim() ?? '',
      headless: config.browserHeadless ?? true,
      viewportWidth: config.browserViewportWidth ?? 1280,
      viewportHeight: config.browserViewportHeight ?? 800,
      defaultTimeoutMs: config.browserTimeoutMs ?? 30_000,
      autoScreenshot: config.browserAutoScreenshot ?? true,
      screenshotFormat: rawFormat === 'png' ? 'png' : 'jpeg',
      screenshotQuality: config.browserScreenshotQuality ?? 60,
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
    });
  },
});
