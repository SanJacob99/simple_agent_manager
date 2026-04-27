import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Browser, BrowserContext, Page } from 'playwright';
// playwright-extra wraps Playwright's browser types with a `.use(plugin)`
// hook. puppeteer-extra-plugin-stealth is a set of patches that hides
// `navigator.webdriver`, plugin arrays, WebGL vendor, "HeadlessChrome" UA,
// and other common automation signals.
//
// NOTE: puppeteer-extra-plugin-stealth has been unmaintained since 2023.
// It still clears most entry-level detections (Cloudflare Bot Fight, basic
// UA / navigator sniffs) but does NOT defeat TLS/JA3 fingerprinting, IP
// reputation, or behavioral analysis. When it falls behind, swap it out.
import { chromium } from 'playwright-extra';
// puppeteer-extra-plugin-stealth ships as CommonJS only. Our server runs
// under ESM (package.json has "type": "module"), so a static `import` of
// the plugin's default export works in TypeScript but fails at runtime on
// tsx because the plugin's own internal `require()` graph blows up. Load
// it via `createRequire` so Node resolves it as CJS the way the plugin
// expects.
const requireCjs = createRequire(import.meta.url);
import type { AskUserContext } from '../human/ask-user';

// Apply stealth exactly once per process. `chromium.use` is idempotent on a
// given plugin instance — we still guard to avoid double-registration if
// this module is re-imported under HMR.
let stealthApplied = false;
function ensureStealthApplied(): void {
  if (stealthApplied) return;
  stealthApplied = true;
  const stealthPlugin = requireCjs('puppeteer-extra-plugin-stealth') as () => unknown;
  chromium.use(stealthPlugin() as Parameters<typeof chromium.use>[0]);
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_PROFILE_DIR = '.browser-profile';
const SCREENSHOT_DIR = 'browser-screenshots';
const MAX_TEXT_CHARS = 12_000;
const MAX_OBSERVE_TEXT_CHARS = 4_000;
const MAX_INTERACTIVE_ELEMENTS = 80;
const DEFAULT_SCROLL_PIXELS = 650;
const GATE_DEFAULT_TIMEOUT_MS = 45_000;
const GATE_MAX_TIMEOUT_MS = 55_000;

type BrowserLoadState = 'load' | 'domcontentloaded' | 'networkidle';

export interface BrowserToolContext {
  cwd: string;
  /** Absolute or cwd-relative path for the persistent profile. Empty = <cwd>/.browser-profile. */
  userDataDir: string;
  /** When true Chromium runs without a visible window. */
  headless: boolean;
  viewportWidth: number;
  viewportHeight: number;
  /** Per-action timeout (navigation, waitFor, etc). */
  defaultTimeoutMs: number;
  /** Attach a screenshot to every mutating action's result so the user sees each step. */
  autoScreenshot: boolean;
  /** Format for auto-attached screenshots. Explicit `screenshot` calls also use this. */
  screenshotFormat: 'jpeg' | 'png';
  /** JPEG quality 1-100. Ignored for PNG. */
  screenshotQuality: number;
  /**
   * Apply the stealth plugin on launch. Default `true`. Does NOT defeat
   * TLS/JA3 fingerprinting, IP reputation, or behavioral analysis.
   */
  stealth: boolean;
  /** BCP-47 locale passed to the context, e.g. `en-US`. Empty = `en-US`. */
  locale?: string;
  /** IANA timezone, e.g. `America/New_York`. Empty = host's current timezone. */
  timezone?: string;
  /** Override the outbound User-Agent string. Empty = Playwright/stealth default. */
  userAgent?: string;
  /**
   * When set, attach to a user-launched Chrome via the Chrome DevTools
   * Protocol instead of launching a persistent context. The user gets a
   * fresh isolated `newContext()` inside their real browser so automation
   * inherits the real TLS fingerprint, cookies, and extensions without
   * touching their default profile. Empty = launch our own Chromium.
   *
   * Typical value: `http://127.0.0.1:9222`. The user must have launched
   * Chrome with `--remote-debugging-port=9222` beforehand.
   */
  cdpEndpoint?: string;
  /**
   * HITL context. When present, state-mutating actions (click/type/select/...)
   * block on a user confirmation banner before touching the page. When absent
   * — e.g. in tests or runs without HITL wiring — gating is skipped and the
   * action runs immediately. See BROWSER_ACTION_CLASSIFICATION for the list.
   */
  hitl?: AskUserContext;
}

/**
 * Actions that can touch the page's state or the user's session. Before
 * executing one, the tool calls the HITL registry with a targeted question
 * so the user sees what's about to happen (selector + URL) and can approve
 * or decline a specific click, not the tool as a whole.
 *
 * Read-only actions (navigate/search/observe/...) are absent from this set
 * and always run immediately. `navigate` counts as read-only here: page
 * loads are intrinsic to `search`, and the subsequent write gates anyway.
 */
export const BROWSER_ACTION_CLASSIFICATION: Record<string, 'read-only' | 'state-mutating'> = {
  navigate: 'read-only',
  search: 'read-only',
  observe: 'read-only',
  text: 'read-only',
  snapshot: 'read-only',
  screenshot: 'read-only',
  scroll: 'read-only',
  wait: 'read-only',
  status: 'read-only',
  list_tabs: 'read-only',
  back: 'read-only',
  forward: 'read-only',
  reload: 'read-only',
  click: 'state-mutating',
  type: 'state-mutating',
  key: 'state-mutating',
  select: 'state-mutating',
  check: 'state-mutating',
  evaluate: 'state-mutating',
  new_tab: 'state-mutating',
  switch_tab: 'state-mutating',
  close_tab: 'state-mutating',
  close: 'state-mutating',
  handover: 'state-mutating',
};

interface BrowserInstance {
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  headless: boolean;
  startedAt: number;
  /**
   * When set, we connected to the user's already-running Chrome via CDP.
   * In that mode we must only ever close the `context` (our isolated
   * context inside their Chrome) — never this `Browser`, which would
   * shut down the user's Chrome instance.
   */
  connectedBrowser?: Browser;
  /**
   * The CDP endpoint this instance was created against. Empty string for
   * persistent-context launches. Used to detect when settings changed
   * between calls (e.g. user hit "Launch Chrome" mid-session) so we can
   * relaunch against the new target instead of returning a stale
   * persistent Chromium.
   */
  cdpEndpoint: string;
  /**
   * True when the tool created the `BrowserContext` (persistent launch,
   * or CDP fallback when the attached Chrome had no existing contexts).
   * False when we reused the user's default context — in that case we
   * must never close the context on teardown, or we'd kill the user's
   * current tabs. We close only the pages we opened.
   */
  ownsContext: boolean;
  /**
   * Pages we opened. On teardown with `!ownsContext` we close only these
   * so the user's existing tabs live on.
   */
  ourPages: Set<Page>;
}

async function teardownInstance(inst: BrowserInstance): Promise<void> {
  if (inst.ownsContext) {
    await inst.context.close().catch(() => {});
    return;
  }
  for (const p of inst.ourPages) {
    if (!p.isClosed()) {
      await p.close().catch(() => {});
    }
  }
}

// Module-level registry — one browser per agent workspace (keyed by
// resolved cwd). Surviving across tool calls is the whole point: login
// cookies, open tabs, and page state all outlive any single invocation.
const INSTANCES = new Map<string, BrowserInstance>();

function instanceKey(ctx: BrowserToolContext): string {
  return path.resolve(ctx.cwd || process.cwd());
}

function resolveUserDataDir(ctx: BrowserToolContext): string {
  const base = ctx.cwd || process.cwd();
  if (!ctx.userDataDir) return path.resolve(base, DEFAULT_PROFILE_DIR);
  return path.isAbsolute(ctx.userDataDir)
    ? ctx.userDataDir
    : path.resolve(base, ctx.userDataDir);
}

async function installNameShim(context: BrowserContext): Promise<void> {
  // The server is bundled with tsx/esbuild using keepNames, which rewrites
  // named functions as `__name(fn, "name")`. When Playwright serializes an
  // evaluate callback with fn.toString(), those `__name(...)` calls travel
  // to the page but the helper doesn't — the browser throws
  // `ReferenceError: __name is not defined`. Shim it on window for every
  // page so evaluate callbacks with named inner helpers just work.
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.__name !== 'function') w.__name = (fn: unknown) => fn;
  });
}

async function getOrLaunch(ctx: BrowserToolContext): Promise<BrowserInstance> {
  const key = instanceKey(ctx);
  const requestedCdp = ctx.cdpEndpoint?.trim() ?? '';
  const existing = INSTANCES.get(key);
  if (existing) {
    // Return the cached instance only when its launch mode still matches
    // what the user is asking for. If they turned CDP on (or off, or
    // pointed it at a different endpoint) between calls, the cached
    // Chromium is the wrong target — evict it and fall through to launch.
    if (existing.cdpEndpoint === requestedCdp) {
      return existing;
    }
    const reason = requestedCdp
      ? existing.cdpEndpoint
        ? `CDP endpoint changed (${existing.cdpEndpoint} → ${requestedCdp})`
        : `CDP endpoint configured (${requestedCdp}) — dropping cached persistent Chromium`
      : `CDP endpoint cleared — dropping cached CDP-attached context`;
    console.warn(`[browser] ${reason}. Relaunching.`);
    INSTANCES.delete(key);
    await teardownInstance(existing);
  }

  const userDataDir = resolveUserDataDir(ctx);
  await fs.mkdir(userDataDir, { recursive: true });

  if (ctx.stealth !== false) {
    ensureStealthApplied();
  }

  const viewport = {
    width: ctx.viewportWidth > 0 ? ctx.viewportWidth : DEFAULT_VIEWPORT.width,
    height: ctx.viewportHeight > 0 ? ctx.viewportHeight : DEFAULT_VIEWPORT.height,
  };

  // Emulation defaults: stop looking like a bare Playwright harness by
  // always sending Accept-Language and a real locale/timezone. The user
  // can override each via settings.
  const resolvedTimezone = ctx.timezone?.trim()
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'America/New_York';
  const resolvedLocale = ctx.locale?.trim() || 'en-US';
  const contextOptions = {
    viewport,
    locale: resolvedLocale,
    timezoneId: resolvedTimezone,
    extraHTTPHeaders: {
      'Accept-Language': `${resolvedLocale},${resolvedLocale.split('-')[0] ?? 'en'};q=0.9`,
    },
    ...(ctx.userAgent?.trim() ? { userAgent: ctx.userAgent.trim() } : {}),
  };

  // CDP attach path. When `cdpEndpoint` is set, we connect to the user's
  // already-running Chrome. Prefer the existing default context over a
  // fresh `newContext()` so the agent's tab opens in the same Chrome
  // window the user is already looking at — an isolated `newContext`
  // renders as a separate, easy-to-miss window. The tradeoff is that we
  // share cookies/storage with whatever is already in that context; users
  // who want isolation should launch a dedicated scratch Chrome (what our
  // "Launch Chrome" button does by default). On connect failure we fall
  // through to the persistent-context path below.
  if (requestedCdp) {
    try {
      const browser = await chromium.connectOverCDP(requestedCdp, {
        timeout: ctx.defaultTimeoutMs,
      });
      const existingContexts = browser.contexts();
      let context: BrowserContext;
      let ownsContext: boolean;
      if (existingContexts.length > 0) {
        context = existingContexts[0];
        ownsContext = false;
        // emulation options (locale/timezone/userAgent) can only be set
        // at newContext-creation time, so they're intentionally skipped
        // here — the user's Chrome already carries its own.
      } else {
        context = await browser.newContext(contextOptions);
        ownsContext = true;
      }
      context.setDefaultTimeout(ctx.defaultTimeoutMs);
      await installNameShim(context);
      const page = await context.newPage();
      const instance: BrowserInstance = {
        context,
        page,
        userDataDir: `(cdp:${requestedCdp})`,
        headless: false,
        startedAt: Date.now(),
        connectedBrowser: browser,
        cdpEndpoint: requestedCdp,
        ownsContext,
        ourPages: new Set<Page>([page]),
      };
      INSTANCES.set(key, instance);
      return instance;
    } catch (err) {
      console.warn(
        `[browser] CDP connect to ${requestedCdp} failed (${(err as Error).message}). `
        + `Falling back to launchPersistentContext. Is Chrome running with --remote-debugging-port?`,
      );
      // Fall through to the persistent-context path below.
    }
  }

  // When the user wants a visible window (headless=false), try that first
  // and fall back to headless if the environment has no display (e.g. a
  // remote server, CI, or a locked-down session). Explicit headless=true
  // is always respected.
  let context: BrowserContext;
  let launchedHeadless = ctx.headless;
  if (ctx.headless) {
    context = await chromium.launchPersistentContext(userDataDir, { ...contextOptions, headless: true });
  } else {
    try {
      context = await chromium.launchPersistentContext(userDataDir, { ...contextOptions, headless: false });
    } catch (err) {
      console.warn(
        `[browser] Headful launch failed (${(err as Error).message}). Falling back to headless.`,
      );
      context = await chromium.launchPersistentContext(userDataDir, { ...contextOptions, headless: true });
      launchedHeadless = true;
    }
  }
  context.setDefaultTimeout(ctx.defaultTimeoutMs);
  await installNameShim(context);

  // launchPersistentContext always opens one page on start; reuse it.
  const page = context.pages()[0] ?? (await context.newPage());

  const instance: BrowserInstance = {
    context,
    page,
    userDataDir,
    headless: launchedHeadless,
    startedAt: Date.now(),
    cdpEndpoint: '',
    ownsContext: true,
    ourPages: new Set<Page>([page]),
  };
  INSTANCES.set(key, instance);
  return instance;
}

function truncate(s: string, max = MAX_TEXT_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...(${s.length - max} chars truncated)`;
}

async function activePage(inst: BrowserInstance): Promise<Page> {
  if (!inst.page.isClosed()) return inst.page;
  // When we own the context, any page in it is fair game; when attached
  // to a shared user context we must stick to pages we opened so we don't
  // hijack one of the user's tabs.
  const pool = inst.ownsContext
    ? inst.context.pages()
    : Array.from(inst.ourPages);
  const alive = pool.find((candidate) => !candidate.isClosed());
  if (alive) {
    inst.page = alive;
    return alive;
  }
  const page = await inst.context.newPage();
  inst.ourPages.add(page);
  inst.page = page;
  return page;
}

function normalizeLoadState(value: unknown): BrowserLoadState {
  return value === 'load' || value === 'networkidle' || value === 'domcontentloaded'
    ? value
    : 'domcontentloaded';
}

function asPositiveTimeout(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function inferBrowserNotices(pageText: string): string[] {
  const lower = pageText.toLowerCase();
  const notices: string[] = [];

  if (
    /captcha|recaptcha|hcaptcha|verify you are human|are you human|unusual traffic|automated traffic|checking your browser|access denied|cloudflare/.test(lower)
  ) {
    notices.push(
      'Possible bot protection, CAPTCHA, or access challenge visible. Do not bypass it. Before giving up, try the same intent against an alternate source: (1) browser(action="search", query="...") rotates search engines automatically, (2) go directly to the relevant aggregator or brand site (e.g. Groupon, Yelp, RetailMeNot, Wikipedia, Reddit, or <brand>.com/deals), (3) fall back to the web_search/web_fetch tools. Only call ask_user after at least two alternate sources also fail or the task genuinely requires this specific site.',
    );
  }

  if (/password|passcode|two-factor|2fa|verification code|one-time code|sign in|log in|login/.test(lower)) {
    notices.push(
      'Possible login or credential step visible. Let the user enter secrets directly in the browser; do not ask for passwords or one-time codes in chat.',
    );
  }

  if (/credit card|card number|security code|cvv|cvc|billing address|payment|checkout|deposit/.test(lower)) {
    notices.push(
      'Possible payment or billing step visible. Pause for user handoff and explicit approval before any charge, deposit, purchase, or saved-payment action.',
    );
  }

  if (
    /confirm reservation|reserve now|book now|place order|buy now|purchase|send message|contact seller|schedule appointment|request appointment|cancel booking|cancel order/.test(lower)
  ) {
    notices.push(
      'Possible commitment step visible. Use confirm_action before submitting reservations, orders, messages, appointments, cancellations, or account changes.',
    );
  }

  return notices;
}

async function pageNoticesText(ctx: BrowserToolContext): Promise<string> {
  const inst = INSTANCES.get(instanceKey(ctx));
  if (!inst) return '';
  const page = await activePage(inst);
  const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const notices = inferBrowserNotices(typeof body === 'string' ? body : String(body));
  if (notices.length === 0) return '';
  return `\n\nBrowser notices:\n${notices.map((notice) => `- ${notice}`).join('\n')}`;
}

function shouldAddBrowserNotices(action: string): boolean {
  return !['status', 'close', 'list_tabs'].includes(action);
}

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

interface InlineScreenshot {
  mimeType: string;
  data: string; // base64
  /** Disk path the capture was also written to, relative to `ctx.cwd` when
   *  possible (workspace-rooted) or absolute otherwise. Allows old
   *  screenshots that get stripped from context to still be reachable via
   *  `read_file` / `show_image`. */
  savedPath: string;
}

async function captureInlineScreenshot(
  page: Page,
  ctx: BrowserToolContext,
  fullPage = false,
): Promise<InlineScreenshot | null> {
  try {
    const format = ctx.screenshotFormat === 'png' ? 'png' : 'jpeg';
    const quality = Math.min(100, Math.max(1, ctx.screenshotQuality || 60));
    const opts: Parameters<Page['screenshot']>[0] = { type: format, fullPage };
    // Playwright rejects `quality` for PNG.
    if (format === 'jpeg') opts.quality = quality;
    const buffer = await page.screenshot(opts);

    const dir = path.resolve(ctx.cwd || process.cwd(), SCREENSHOT_DIR);
    await fs.mkdir(dir, { recursive: true });
    const ext = format === 'png' ? 'png' : 'jpg';
    const absPath = path.join(dir, `auto-${Date.now()}.${ext}`);
    await fs.writeFile(absPath, buffer);

    const base = ctx.cwd ? path.resolve(ctx.cwd) : '';
    const savedPath = base && absPath.startsWith(base)
      ? path.relative(base, absPath).replace(/\\/g, '/')
      : absPath;

    return {
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      data: buffer.toString('base64'),
      savedPath,
    };
  } catch {
    // A failing screenshot should never mask the action result. The
    // common case is "page went away mid-action" — the text output will
    // already reflect that.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Action handlers — each returns a text summary plus a flag indicating
// whether an auto-screenshot should be attached (when autoScreenshot is on).
// The explicit `screenshot` action returns `attach: 'force'` to bypass the
// toggle and always attach, matching the agent's intent.
// ---------------------------------------------------------------------------

type Attach = 'auto' | 'force' | 'none';

interface ActionResult {
  text: string;
  attach: Attach;
  /** Only meaningful when attach is 'force' — passes the fullPage flag through. */
  fullPage?: boolean;
}

async function doNavigate(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const url = String(params.url ?? '').trim();
  if (!url) throw new Error('url is required for action="navigate"');
  const inst = await getOrLaunch(ctx);
  await inst.page.goto(url, { timeout: ctx.defaultTimeoutMs, waitUntil: 'domcontentloaded' });
  const title = await inst.page.title().catch(() => '');
  return {
    text: `Navigated to ${inst.page.url()}${title ? ` — "${title}"` : ''}`,
    attach: 'auto',
  };
}

type SearchEngineId = 'duckduckgo' | 'bing' | 'brave' | 'startpage' | 'ecosia';

const SEARCH_ENGINES: Record<SearchEngineId, { label: string; urlFor: (q: string) => string }> = {
  duckduckgo: {
    label: 'DuckDuckGo (HTML)',
    urlFor: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  },
  bing: {
    label: 'Bing',
    urlFor: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  brave: {
    label: 'Brave Search',
    urlFor: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  },
  startpage: {
    label: 'Startpage',
    urlFor: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
  },
  ecosia: {
    label: 'Ecosia',
    urlFor: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}`,
  },
};

// DuckDuckGo's lightweight HTML endpoint rarely presents a CAPTCHA, so we
// try it first. Google is deliberately omitted because its SERP is almost
// always blocked for Playwright traffic.
const DEFAULT_SEARCH_ORDER: SearchEngineId[] = ['duckduckgo', 'bing', 'brave', 'startpage', 'ecosia'];

function resolveSearchOrder(engine: unknown): SearchEngineId[] {
  if (typeof engine === 'string' && engine in SEARCH_ENGINES) {
    const preferred = engine as SearchEngineId;
    return [preferred, ...DEFAULT_SEARCH_ORDER.filter((id) => id !== preferred)];
  }
  return DEFAULT_SEARCH_ORDER;
}

function isBotProtected(bodyText: string): boolean {
  return inferBrowserNotices(bodyText).some((n) => n.startsWith('Possible bot protection'));
}

async function doSearch(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const query = String(params.query ?? '').trim();
  if (!query) throw new Error('query is required for action="search"');
  const order = resolveSearchOrder(params.engine);
  const inst = await getOrLaunch(ctx);

  const attempts: Array<{ engine: SearchEngineId; url: string; outcome: string }> = [];

  for (const engineId of order) {
    const engine = SEARCH_ENGINES[engineId];
    const url = engine.urlFor(query);
    try {
      await inst.page.goto(url, { timeout: ctx.defaultTimeoutMs, waitUntil: 'domcontentloaded' });
      const body = await inst.page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const bodyText = typeof body === 'string' ? body : String(body);
      if (isBotProtected(bodyText)) {
        attempts.push({ engine: engineId, url, outcome: 'blocked' });
        continue;
      }
      const title = await inst.page.title().catch(() => '');
      attempts.push({ engine: engineId, url, outcome: 'ok' });
      const attemptSummary = attempts
        .map((a) => `  ${a.engine.padEnd(11)} ${a.outcome}`)
        .join('\n');
      return {
        text: [
          `Search via ${engine.label} — query "${query}"`,
          `URL: ${inst.page.url()}`,
          title ? `Title: ${title}` : '',
          '',
          'Results preview:',
          truncate(bodyText, MAX_OBSERVE_TEXT_CHARS),
          '',
          `Engines tried:`,
          attemptSummary,
        ].filter(Boolean).join('\n'),
        attach: 'auto',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ engine: engineId, url, outcome: `error: ${message}` });
    }
  }

  const summary = attempts.map((a) => `  ${a.engine.padEnd(11)} ${a.outcome}`).join('\n');
  throw new Error(
    `All ${attempts.length} search engines failed for "${query}":\n${summary}\n\n` +
      `Next options: try a direct aggregator/brand URL via action="navigate", switch to the web_search tool, or call ask_user for a site suggestion.`,
  );
}

async function doClick(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const selector = String(params.selector ?? '').trim();
  if (!selector) throw new Error('selector is required for action="click"');
  const inst = await getOrLaunch(ctx);
  await inst.page.click(selector, { timeout: ctx.defaultTimeoutMs });
  return { text: `Clicked ${selector} — now at ${inst.page.url()}`, attach: 'auto' };
}

async function doType(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const selector = String(params.selector ?? '').trim();
  const text = typeof params.text === 'string' ? params.text : '';
  if (!selector) throw new Error('selector is required for action="type"');
  const inst = await getOrLaunch(ctx);
  await inst.page.fill(selector, text, { timeout: ctx.defaultTimeoutMs });
  return { text: `Typed ${text.length} chars into ${selector}`, attach: 'auto' };
}

async function doKey(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const key = String(params.key ?? '').trim();
  if (!key) throw new Error('key is required for action="key"');
  const selector = typeof params.selector === 'string' ? params.selector.trim() : '';
  const inst = await getOrLaunch(ctx);
  if (selector) {
    await inst.page.press(selector, key, { timeout: ctx.defaultTimeoutMs });
    return { text: `Pressed ${key} on ${selector}`, attach: 'auto' };
  }
  await inst.page.keyboard.press(key);
  return { text: `Pressed ${key}`, attach: 'auto' };
}

async function doEvaluate(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const expression = String(params.expression ?? '').trim();
  if (!expression) throw new Error('expression is required for action="evaluate"');
  const inst = await getOrLaunch(ctx);
  // Wrap in an IIFE so the model can paste either a bare expression or a
  // block of statements with a `return`. Evaluate runs inside the page, so
  // this can't reach any server-side state.
  const wrapped = `(() => { ${expression.includes('return ') ? expression : `return ${expression}`} })()`;
  const result = await inst.page.evaluate(wrapped);
  return {
    text: truncate(typeof result === 'string' ? result : JSON.stringify(result, null, 2)),
    attach: 'none',
  };
}

async function doText(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const selector = typeof params.selector === 'string' ? params.selector.trim() : '';
  const inst = await getOrLaunch(ctx);
  if (selector) {
    const count = await inst.page.locator(selector).count();
    if (count === 0) {
      return { text: `(0 matches for ${selector})`, attach: 'none' };
    }
    const texts = await inst.page.locator(selector).allTextContents();
    return { text: truncate(texts.map((t, i) => `[${i}] ${t.trim()}`).join('\n')), attach: 'none' };
  }
  const body = await inst.page.evaluate(() => document.body?.innerText ?? '');
  return { text: truncate(typeof body === 'string' ? body : String(body)), attach: 'none' };
}

async function doScreenshot(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const fullPage = params.fullPage === true;
  // Persist a PNG for later reference, independent of the inline format
  // (which may be JPEG for bandwidth). Explicit screenshots are "please
  // give me the best capture" — worth the disk space.
  const dir = path.resolve(ctx.cwd || process.cwd(), SCREENSHOT_DIR);
  await fs.mkdir(dir, { recursive: true });
  const name = `screenshot-${Date.now()}.png`;
  const target = path.join(dir, name);
  await inst.page.screenshot({ path: target, fullPage, type: 'png' });
  return {
    text: `Screenshot saved to ${target} (${inst.page.url()})`,
    attach: 'force',
    fullPage,
  };
}

async function doSnapshot(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  const accessibility = (page as Page & {
    accessibility?: { snapshot: (opts: { interestingOnly: boolean }) => Promise<unknown> };
  }).accessibility;
  if (!accessibility) {
    const observed = await doObserve(_params, ctx);
    return {
      text: `Accessibility snapshot is unavailable in this Playwright build. Falling back to observe.\n\n${observed.text}`,
      attach: 'none',
    };
  }
  const snap = await accessibility.snapshot({ interestingOnly: true });
  return { text: truncate(JSON.stringify(snap, null, 2)), attach: 'none' };
}

async function doBack(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  await inst.page.goBack({ timeout: ctx.defaultTimeoutMs });
  return { text: `Back → ${inst.page.url()}`, attach: 'auto' };
}

async function doForward(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  await inst.page.goForward({ timeout: ctx.defaultTimeoutMs });
  return { text: `Forward → ${inst.page.url()}`, attach: 'auto' };
}

async function doReload(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  await inst.page.reload({ timeout: ctx.defaultTimeoutMs });
  return { text: `Reloaded → ${inst.page.url()}`, attach: 'auto' };
}

async function doClose(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const key = instanceKey(ctx);
  const inst = INSTANCES.get(key);
  if (!inst) return { text: 'Browser is not running.', attach: 'none' };
  INSTANCES.delete(key);
  // teardownInstance honors `ownsContext`: it only closes the context when
  // we created it, and otherwise closes the pages we opened so the user's
  // existing tabs survive. We explicitly never call `browser.close()` on
  // `connectedBrowser` — in Playwright that would shut down the user's
  // entire Chrome. The CDP websocket is GC'd when we drop the reference.
  await teardownInstance(inst);
  const location = inst.connectedBrowser ? 'user Chrome (via CDP)' : inst.userDataDir;
  return {
    text: `Browser closed. Profile preserved at ${location}`,
    attach: 'none',
  };
}

async function doStatus(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const key = instanceKey(ctx);
  const inst = INSTANCES.get(key);
  if (!inst) return { text: 'Browser is not running.', attach: 'none' };
  const url = inst.page.url();
  const title = await inst.page.title().catch(() => '');
  const uptimeSec = Math.round((Date.now() - inst.startedAt) / 1000);
  const mode = inst.connectedBrowser
    ? inst.ownsContext
      ? 'attached to user Chrome via CDP, isolated context'
      : 'attached to user Chrome via CDP, sharing the existing default context'
    : inst.headless
      ? 'headless'
      : 'visible window';
  return {
    text: [
      `Browser running (${mode}).`,
      `  url: ${url}`,
      title ? `  title: ${title}` : null,
      `  profile: ${inst.userDataDir}`,
      `  uptime: ${uptimeSec}s`,
    ]
      .filter(Boolean)
      .join('\n'),
    attach: 'none',
  };
}

async function doObserve(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  const title = await page.title().catch(() => '');
  const url = page.url();
  const payload = await page.evaluate(
    ({ maxTextChars, maxElements }) => {
      const collapse = (value: string | null | undefined) =>
        (value ?? '').replace(/\s+/g, ' ').trim();
      const limit = (value: string, max: number) =>
        value.length > max ? `${value.slice(0, max)}...` : value;
      const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const cssEscape = (value: string) =>
        value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
      const isVisible = (el: Element) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const roleFor = (el: Element) => {
        const explicit = el.getAttribute('role');
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'input') {
          const type = (el.getAttribute('type') ?? 'text').toLowerCase();
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'submit' || type === 'button') return 'button';
          return 'textbox';
        }
        return '';
      };
      const labelFor = (el: Element) => {
        const labelledBy = el.getAttribute('aria-labelledby');
        const labelledText = labelledBy
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText)
          .filter(Boolean)
          .join(' ');
        const input = el as HTMLInputElement;
        const inputButtonValue =
          input.value && ['button', 'submit', 'reset'].includes((input.type ?? '').toLowerCase())
            ? input.value
            : '';
        const candidates = [
          el.getAttribute('aria-label'),
          labelledText,
          el.getAttribute('placeholder'),
          el.getAttribute('title'),
          inputButtonValue,
          (el as HTMLElement).innerText,
          el.getAttribute('name'),
          el.id,
        ];
        return candidates.map(collapse).find(Boolean) ?? '';
      };
      const selectorFor = (el: Element, role: string, label: string) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id;
        if (id) return `#${cssEscape(id)}`;
        const name = el.getAttribute('name');
        if (name) return `${tag}[name="${quote(name)}"]`;
        if (role && label) return `role=${role}[name="${quote(limit(label, 80))}"]`;
        if (label && ['a', 'button', 'summary'].includes(tag)) return `text="${quote(limit(label, 80))}"`;
        return tag;
      };

      const text = collapse(document.body?.innerText ?? '');
      const selectors = [
        'a[href]',
        'button',
        'input',
        'textarea',
        'select',
        'summary',
        '[role]',
        '[contenteditable="true"]',
      ].join(',');
      const seen = new Set<Element>();
      const elements = Array.from(document.querySelectorAll(selectors))
        .filter((el) => {
          if (seen.has(el) || !isVisible(el)) return false;
          seen.add(el);
          return true;
        })
        .slice(0, maxElements)
        .map((el, index) => {
          const role = roleFor(el);
          const label = limit(labelFor(el), 120);
          const href = el instanceof HTMLAnchorElement ? el.href : '';
          return {
            index,
            tag: el.tagName.toLowerCase(),
            role,
            label,
            selector: selectorFor(el, role, label),
            href,
          };
        });
      return { text: limit(text, maxTextChars), elements };
    },
    { maxTextChars: MAX_OBSERVE_TEXT_CHARS, maxElements: MAX_INTERACTIVE_ELEMENTS },
  );

  const lines = [
    `url: ${url}`,
    title ? `title: ${title}` : null,
    '',
    'visible text:',
    payload.text || '(no visible text)',
    '',
    `interactive elements (${payload.elements.length}):`,
    ...payload.elements.map((el) => {
      const label = el.label ? ` "${el.label}"` : '';
      const href = el.href ? ` href=${el.href}` : '';
      return `[${el.index}] ${el.role || el.tag}${label} selector=${el.selector}${href}`;
    }),
  ].filter((line): line is string => line !== null);

  return { text: truncate(lines.join('\n')), attach: 'none' };
}

async function doWait(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  const timeout = asPositiveTimeout(params.timeoutMs, ctx.defaultTimeoutMs);
  const selector = typeof params.selector === 'string' ? params.selector.trim() : '';
  if (selector) {
    await page.waitForSelector(selector, { timeout });
    return { text: `Waited for selector ${selector}`, attach: 'none' };
  }
  const state = normalizeLoadState(params.loadState);
  await page.waitForLoadState(state, { timeout });
  return { text: `Waited for load state ${state} at ${page.url()}`, attach: 'none' };
}

async function doScroll(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  const amount = typeof params.amount === 'number' && Number.isFinite(params.amount)
    ? Math.abs(params.amount)
    : DEFAULT_SCROLL_PIXELS;
  let x = typeof params.x === 'number' && Number.isFinite(params.x) ? params.x : 0;
  let y = typeof params.y === 'number' && Number.isFinite(params.y) ? params.y : 0;
  const direction = String(params.direction ?? '').toLowerCase();
  if (x === 0 && y === 0) {
    if (direction === 'up') y = -amount;
    else if (direction === 'left') x = -amount;
    else if (direction === 'right') x = amount;
    else y = amount;
  }
  await page.mouse.wheel(x, y);
  return { text: `Scrolled by x=${x}, y=${y}`, attach: 'auto' };
}

async function doSelect(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const selector = String(params.selector ?? '').trim();
  if (!selector) throw new Error('selector is required for action="select"');
  const value = typeof params.value === 'string' ? params.value : '';
  const label = typeof params.label === 'string' ? params.label : '';
  if (!value && !label) throw new Error('value or label is required for action="select"');
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  const selected = await page.selectOption(
    selector,
    label ? { label } : { value },
    { timeout: ctx.defaultTimeoutMs },
  );
  return { text: `Selected ${selected.join(', ') || label || value} in ${selector}`, attach: 'auto' };
}

async function doCheck(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const selector = String(params.selector ?? '').trim();
  if (!selector) throw new Error('selector is required for action="check"');
  const checked = params.checked !== false;
  const inst = await getOrLaunch(ctx);
  const page = await activePage(inst);
  if (checked) await page.check(selector, { timeout: ctx.defaultTimeoutMs });
  else await page.uncheck(selector, { timeout: ctx.defaultTimeoutMs });
  return { text: `${checked ? 'Checked' : 'Unchecked'} ${selector}`, attach: 'auto' };
}

/**
 * Tab-level operations scope themselves to pages the tool owns when
 * attached to a shared user context — otherwise `list_tabs` would leak
 * the user's personal tabs and `switch_tab`/`close_tab` could hijack or
 * close them. When we own the context, every page in it is fair game.
 */
function visibleTabs(inst: BrowserInstance): Page[] {
  if (inst.ownsContext) return inst.context.pages().filter((p) => !p.isClosed());
  return Array.from(inst.ourPages).filter((p) => !p.isClosed());
}

async function doListTabs(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const pages = visibleTabs(inst);
  const active = await activePage(inst);
  const lines = await Promise.all(
    pages.map(async (page, index) => {
      const title = await page.title().catch(() => '');
      const marker = page === active ? '*' : ' ';
      return `${marker} [${index}] ${page.url()}${title ? ` - ${title}` : ''}`;
    }),
  );
  const scope = inst.ownsContext ? '' : ' (agent tabs only; your other tabs are hidden)';
  return { text: `${lines.join('\n')}${scope}`, attach: 'none' };
}

async function doNewTab(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await inst.context.newPage();
  inst.ourPages.add(page);
  inst.page = page;
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (url) {
    await page.goto(url, { timeout: ctx.defaultTimeoutMs, waitUntil: 'domcontentloaded' });
  }
  const title = await page.title().catch(() => '');
  const index = visibleTabs(inst).indexOf(page);
  return { text: `Opened tab ${index} at ${page.url()}${title ? ` - ${title}` : ''}`, attach: 'auto' };
}

async function doSwitchTab(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const pages = visibleTabs(inst);
  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
    throw new Error(`index must be between 0 and ${Math.max(0, pages.length - 1)}`);
  }
  inst.page = pages[index];
  await inst.page.bringToFront().catch(() => {});
  const title = await inst.page.title().catch(() => '');
  return { text: `Switched to tab ${index}: ${inst.page.url()}${title ? ` - ${title}` : ''}`, attach: 'auto' };
}

async function doCloseTab(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const pages = visibleTabs(inst);
  if (pages.length <= 1) {
    return { text: 'Cannot close the only open tab. Use action="close" to shut down the browser.', attach: 'none' };
  }
  const active = await activePage(inst);
  const fallbackIndex = Math.max(0, pages.indexOf(active));
  const rawIndex = params.index === undefined ? fallbackIndex : Number(params.index);
  if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= pages.length) {
    throw new Error(`index must be between 0 and ${pages.length - 1}`);
  }
  const target = pages[rawIndex];
  inst.ourPages.delete(target);
  await target.close().catch(() => {});
  const remaining = visibleTabs(inst);
  inst.page = remaining[Math.min(rawIndex, remaining.length - 1)] ?? (await inst.context.newPage());
  if (!inst.ourPages.has(inst.page)) inst.ourPages.add(inst.page);
  return { text: `Closed tab ${rawIndex}. Active tab is now ${inst.page.url()}`, attach: 'auto' };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const BROWSER_DESCRIPTION = [
  'Drive a real Chromium browser (visible window by default, falls back to headless if no display is available) to read and interact with live web pages for user-directed tasks.',
  'Use it for browsing, research, comparing products/listings, coupon hunting, reservations, forms, and JavaScript-heavy pages.',
  'A persistent profile survives across calls so cookies, tabs, and login state stick.',
  'By default, every state-changing action also returns a screenshot so the user can watch progress.',
  '',
  'Respectful-use policy:',
  '  - Do not bypass CAPTCHA, bot protection, paywalls, access controls, or site blocks. Instead, try at least two alternate sources for the same intent before escalating: action="search" auto-rotates engines, or navigate to an aggregator/brand site directly, or fall back to web_search/web_fetch. If the task genuinely requires that specific blocked site and you cannot route around it, call action="handover" so the user can solve the human step in the visible Chrome window.',
  '',
  'Confirmation policy:',
  '  - The browser tool gates itself. You do NOT need to call `confirm_action` before browser actions — the tool will prompt the user at the moment a committing action (click/type/select/check/key/evaluate/new_tab/switch_tab/close_tab/close/handover) actually runs, with the exact selector and URL. Read-only actions (navigate/search/observe/text/snapshot/screenshot/scroll/wait/status/list_tabs/back/forward/reload) proceed without a prompt.',
  '  - Do not ask for passwords, one-time codes, payment cards, or other secrets in chat. Hand those steps to the user in the browser; if running headless, explain that visible-browser mode or another authorized source is needed.',
  '  - Before final submissions that commit the user (reservation, purchase, payment, message, appointment, cancellation, account change), call confirm_action and wait for yes.',
  '  - Publicly shown coupon codes may be tried; do not brute-force coupon endpoints or generate/guess codes at scale.',
  '',
  'Actions:',
  '  navigate    - go to a URL. Auto-launches the browser on first use. Params: url.',
  '  search      - search the web and return the SERP. Rotates through DuckDuckGo/Bing/Brave/Startpage/Ecosia automatically when one is bot-blocked. Params: query, engine? (preferred first).',
  '  observe     - return URL, title, visible text, and interactive elements with suggested selectors.',
  '  click       - click an element. Params: selector (CSS, text="...", or role=...).',
  '  type        - fill an input. Params: selector, text.',
  '  key         - press a key. Params: key (e.g. "Enter"), selector? (focus first).',
  '  select      - choose an option in a <select>. Params: selector, value? or label?.',
  '  check       - check/uncheck a checkbox or radio. Params: selector, checked? (default true).',
  '  scroll      - scroll the page. Params: direction? (down/up/left/right), amount?, x?, y?.',
  '  wait        - wait for a selector or load state. Params: selector? or loadState?, timeoutMs?.',
  '  text        - return innerText. Params: selector? (omit for whole page body).',
  '  evaluate    - run JS inside the page and return the result. Params: expression.',
  '  snapshot    - accessibility tree (compact, structured view of interactive elements).',
  '  screenshot  - save a PNG under <cwd>/browser-screenshots/ and return the image inline. Params: fullPage?',
  '  back / forward / reload - history navigation.',
  '  list_tabs / new_tab / switch_tab / close_tab - manage multiple tabs. Params: url? or index?.',
  '  status      - whether the browser is running, current URL, uptime.',
  '  close       - shut down the browser (profile is kept).',
  '  handover    - pause the run and ask the user to finish a human step (CAPTCHA, login, 2FA, payment) in the visible Chrome window. Requires headless=false. Returns the post-handover page state. Params: reason (captcha|login|2fa|payment|other), instructions (what the user should do), timeoutSeconds?.',
  '',
  'Typical loop: navigate -> observe (or screenshot + vision) -> click/type/select/check -> wait/observe.',
  'Playwright selectors: CSS (`.cls`, `#id`, `a[href*="foo"]`), text (`text="Sign in"`), role (`role=button[name="Submit"]`).',
].join('\n');

function attachesScreenshot(outcome: ActionResult, ctx: BrowserToolContext): boolean {
  if (outcome.attach === 'force') return true;
  if (outcome.attach === 'auto') return ctx.autoScreenshot;
  return false;
}

function truncateForQuestion(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Build a yes/no question for the HITL gate that names the specific action
 * and target. The user sees e.g. "Browser: click `role=button[name="Buy"]`
 * on https://store.example.com/checkout?" — not just "use the browser?".
 */
export function buildGateQuestion(action: string, params: any, ctx: BrowserToolContext): string {
  const inst = INSTANCES.get(instanceKey(ctx));
  const url = inst?.page.isClosed() ? '' : inst?.page.url() ?? '';
  const at = url ? ` on ${url}` : '';

  switch (action) {
    case 'click': {
      const selector = String(params.selector ?? '').trim() || '(unspecified)';
      return `Browser: click \`${truncateForQuestion(selector)}\`${at}?`;
    }
    case 'type': {
      const selector = String(params.selector ?? '').trim() || '(unspecified)';
      const text = typeof params.text === 'string' ? params.text : '';
      return `Browser: type "${truncateForQuestion(text, 40)}" into \`${truncateForQuestion(selector)}\`${at}?`;
    }
    case 'key': {
      const key = String(params.key ?? '').trim() || '(unspecified)';
      const selector = String(params.selector ?? '').trim();
      return `Browser: press "${key}"${selector ? ` on \`${truncateForQuestion(selector)}\`` : ''}${at}?`;
    }
    case 'select': {
      const selector = String(params.selector ?? '').trim() || '(unspecified)';
      const choice = String(params.label ?? params.value ?? '(unspecified)');
      return `Browser: select "${truncateForQuestion(choice, 40)}" in \`${truncateForQuestion(selector)}\`${at}?`;
    }
    case 'check': {
      const selector = String(params.selector ?? '').trim() || '(unspecified)';
      const verb = params.checked === false ? 'uncheck' : 'check';
      return `Browser: ${verb} \`${truncateForQuestion(selector)}\`${at}?`;
    }
    case 'evaluate': {
      const expr = String(params.expression ?? '');
      return `Browser: evaluate \`${truncateForQuestion(expr, 100)}\`${at}?`;
    }
    case 'new_tab': {
      const target = String(params.url ?? '').trim();
      return `Browser: open a new tab${target ? ` at ${target}` : ''}?`;
    }
    case 'switch_tab':
      return `Browser: switch to tab ${params.index ?? '(unspecified)'}?`;
    case 'close_tab':
      return `Browser: close tab ${params.index ?? '(active)'}${at}?`;
    case 'close':
      return `Browser: shut down the entire browser session?`;
    case 'handover': {
      const reason = String(params.reason ?? 'other');
      const instructions = String(params.instructions ?? '').trim();
      const extras = instructions ? ` ${instructions}` : '';
      const loc = url ? ` at ${url}` : '';
      return `Browser needs you to take over (${reason})${loc}.${extras} Do the step in the Chrome window, then answer "yes" to resume, or "no" to decline.`;
    }
    default:
      return `Browser: run action "${action}"${at}?`;
  }
}

type GateOutcome =
  | { proceed: true }
  | { proceed: false; result: AgentToolResult<undefined> };

/**
 * Gate state-mutating actions through the HITL registry. Read-only actions
 * and contexts without HITL wiring proceed immediately. A "no" or timeout
 * returns a structured declined result so the model can see the decline
 * and pick a different path instead of looping on the same call.
 */
export async function gateIfWriting(
  toolCallId: string,
  action: string,
  params: any,
  ctx: BrowserToolContext,
  signal: AbortSignal | undefined,
): Promise<GateOutcome> {
  if (BROWSER_ACTION_CLASSIFICATION[action] !== 'state-mutating') {
    return { proceed: true };
  }
  const hitl = ctx.hitl;
  if (!hitl) return { proceed: true };
  const sessionKey = hitl.getSessionKey();
  if (!sessionKey) return { proceed: true };

  const requestedTimeoutMs = Math.min(
    typeof params.timeoutSeconds === 'number' && params.timeoutSeconds > 0
      ? params.timeoutSeconds * 1000
      : GATE_DEFAULT_TIMEOUT_MS,
    GATE_MAX_TIMEOUT_MS,
  );
  const question = buildGateQuestion(action, params, ctx);

  hitl.emit({
    type: 'hitl:input_required',
    agentId: hitl.agentId,
    sessionKey,
    toolCallId,
    toolName: 'browser',
    kind: 'confirm',
    question,
    timeoutMs: requestedTimeoutMs,
    createdAt: Date.now(),
  });

  const onAbort = () => {
    hitl.registry.resolve(hitl.agentId, sessionKey, toolCallId, {
      cancelled: true,
      reason: 'aborted',
    });
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let answer;
  try {
    answer = await hitl.registry.register({
      agentId: hitl.agentId,
      sessionKey,
      toolCallId,
      toolName: 'browser',
      kind: 'confirm',
      question,
      timeoutMs: requestedTimeoutMs,
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  hitl.emit({
    type: 'hitl:resolved',
    agentId: hitl.agentId,
    sessionKey,
    toolCallId,
    outcome: 'cancelled' in answer ? 'cancelled' : 'answered',
    reason: 'cancelled' in answer ? answer.reason : undefined,
  });

  if ('cancelled' in answer || answer.answer === 'no') {
    const reason = 'cancelled' in answer ? answer.reason : 'declined';
    return {
      proceed: false,
      result: {
        content: [{
          type: 'text',
          text:
            `Browser action \`${action}\` was not approved by the user (${reason}). `
            + `Ask the user what to do next or try a different approach — do not retry the same call.`,
        }],
        details: undefined,
      },
    };
  }

  return { proceed: true };
}

async function doHandover(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  // Gate has already fired; the user has finished whatever they needed to do
  // and answered "yes". Capture the post-handover page state so the model
  // immediately sees what the user did.
  const inst = INSTANCES.get(instanceKey(ctx));
  if (!inst) {
    throw new Error('handover: browser has not been launched yet — nothing to hand over.');
  }
  const page = await activePage(inst);
  const url = page.url();
  const title = await page.title().catch(() => '');
  const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const bodyText = typeof body === 'string' ? body : String(body);
  return {
    text: [
      `Handover resumed. URL: ${url}${title ? ` — "${title}"` : ''}`,
      '',
      'Visible text:',
      truncate(bodyText, MAX_OBSERVE_TEXT_CHARS),
    ].join('\n'),
    attach: 'force',
  };
}

export function createBrowserTool(ctx: BrowserToolContext): AgentTool<TSchema> {
  return {
    name: 'browser',
    description: BROWSER_DESCRIPTION,
    label: 'Browser',
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal('navigate'),
          Type.Literal('search'),
          Type.Literal('observe'),
          Type.Literal('click'),
          Type.Literal('type'),
          Type.Literal('key'),
          Type.Literal('select'),
          Type.Literal('check'),
          Type.Literal('scroll'),
          Type.Literal('wait'),
          Type.Literal('text'),
          Type.Literal('evaluate'),
          Type.Literal('snapshot'),
          Type.Literal('screenshot'),
          Type.Literal('back'),
          Type.Literal('forward'),
          Type.Literal('reload'),
          Type.Literal('list_tabs'),
          Type.Literal('new_tab'),
          Type.Literal('switch_tab'),
          Type.Literal('close_tab'),
          Type.Literal('status'),
          Type.Literal('close'),
          Type.Literal('handover'),
        ],
        { description: 'Which browser operation to perform' },
      ),
      url: Type.Optional(Type.String({ description: 'Target URL (navigate)' })),
      query: Type.Optional(Type.String({ description: 'Search query (search)' })),
      engine: Type.Optional(
        Type.String({
          description:
            'Preferred search engine for action="search". One of duckduckgo, bing, brave, startpage, ecosia. Other engines are used as automatic fallbacks when the preferred one is blocked.',
        }),
      ),
      selector: Type.Optional(
        Type.String({
          description:
            'Playwright selector (CSS / text="..." / role=...). Required for click/type/key/select/check; optional for text/wait.',
        }),
      ),
      text: Type.Optional(Type.String({ description: 'Text to fill (type)' })),
      key: Type.Optional(Type.String({ description: 'Key name, e.g. "Enter" (key)' })),
      value: Type.Optional(Type.String({ description: 'Option value to select (select)' })),
      label: Type.Optional(Type.String({ description: 'Visible option label to select (select)' })),
      checked: Type.Optional(Type.Boolean({ description: 'Whether a checkbox/radio should be checked (check). Default true.' })),
      direction: Type.Optional(Type.String({ description: 'Scroll direction: down, up, left, right (scroll)' })),
      amount: Type.Optional(Type.Number({ description: 'Scroll amount in pixels (scroll). Default 650.' })),
      x: Type.Optional(Type.Number({ description: 'Horizontal wheel delta in pixels (scroll)' })),
      y: Type.Optional(Type.Number({ description: 'Vertical wheel delta in pixels (scroll)' })),
      loadState: Type.Optional(Type.String({ description: 'Load state to wait for: load, domcontentloaded, or networkidle (wait)' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Override timeout in milliseconds (wait)' })),
      index: Type.Optional(Type.Number({ description: 'Tab index (switch_tab / close_tab)' })),
      expression: Type.Optional(
        Type.String({ description: 'JavaScript to evaluate in the page (evaluate)' }),
      ),
      fullPage: Type.Optional(
        Type.Boolean({ description: 'Full-page screenshot (screenshot). Default false.' }),
      ),
      reason: Type.Optional(
        Type.String({
          description:
            'Why the agent needs a human in the loop (handover). One of: captcha, login, 2fa, payment, other.',
        }),
      ),
      instructions: Type.Optional(
        Type.String({
          description:
            'Short instructions the user will see in the handover banner — e.g. "solve the Cloudflare Turnstile" (handover).',
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description:
            `How long to wait for user approval on state-mutating actions (click/type/... and handover). Default ${GATE_DEFAULT_TIMEOUT_MS / 1000}s, max ${GATE_MAX_TIMEOUT_MS / 1000}s.`,
        }),
      ),
    }),
    execute: async (toolCallId, params: any, signal): Promise<AgentToolResult<undefined>> => {
      const action = String(params?.action ?? '').trim();
      if (!action) throw new Error('action is required');

      if (signal?.aborted) {
        return { content: [{ type: 'text', text: '[aborted before execution]' }], details: undefined };
      }

      // `handover` only makes sense against an already-launched visible
      // browser — the user can't solve a CAPTCHA in a window that doesn't
      // exist. Fail before gating so the banner never asks for something
      // impossible.
      if (action === 'handover') {
        const inst = INSTANCES.get(instanceKey(ctx));
        if (!inst) {
          throw new Error('handover: browser has not been launched yet — navigate first.');
        }
        if (inst.headless) {
          throw new Error('handover requires a visible browser window — set browserHeadless=false and relaunch.');
        }
      }

      // HITL gate for state-mutating actions. `gateIfWriting` is a no-op
      // for read-only actions and for runs without HITL wiring.
      const gate = await gateIfWriting(toolCallId, action, params, ctx, signal);
      if (!gate.proceed) return gate.result;

      // Register an abort handler that closes the browser. Playwright's
      // actions don't take a signal, so the cleanest cancellation we
      // have is "tear down our pages/context" — the next tool call will
      // relaunch. teardownInstance keeps the user's Chrome alive when we
      // are attached to a shared context.
      const onAbort = () => {
        const key = instanceKey(ctx);
        const inst = INSTANCES.get(key);
        if (!inst) return;
        INSTANCES.delete(key);
        void teardownInstance(inst);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        let outcome: ActionResult;
        switch (action) {
          case 'navigate':   outcome = await doNavigate(params, ctx); break;
          case 'search':     outcome = await doSearch(params, ctx); break;
          case 'observe':    outcome = await doObserve(params, ctx); break;
          case 'click':      outcome = await doClick(params, ctx); break;
          case 'type':       outcome = await doType(params, ctx); break;
          case 'key':        outcome = await doKey(params, ctx); break;
          case 'select':     outcome = await doSelect(params, ctx); break;
          case 'check':      outcome = await doCheck(params, ctx); break;
          case 'scroll':     outcome = await doScroll(params, ctx); break;
          case 'wait':       outcome = await doWait(params, ctx); break;
          case 'text':       outcome = await doText(params, ctx); break;
          case 'evaluate':   outcome = await doEvaluate(params, ctx); break;
          case 'snapshot':   outcome = await doSnapshot(params, ctx); break;
          case 'screenshot': outcome = await doScreenshot(params, ctx); break;
          case 'back':       outcome = await doBack(params, ctx); break;
          case 'forward':    outcome = await doForward(params, ctx); break;
          case 'reload':     outcome = await doReload(params, ctx); break;
          case 'list_tabs':  outcome = await doListTabs(params, ctx); break;
          case 'new_tab':    outcome = await doNewTab(params, ctx); break;
          case 'switch_tab': outcome = await doSwitchTab(params, ctx); break;
          case 'close_tab':  outcome = await doCloseTab(params, ctx); break;
          case 'status':     outcome = await doStatus(params, ctx); break;
          case 'close':      outcome = await doClose(params, ctx); break;
          case 'handover':   outcome = await doHandover(params, ctx); break;
          default:
            throw new Error(`Unknown action "${action}".`);
        }

        const content: AgentToolResult<undefined>['content'] = [];
        let extraText = '';
        if (attachesScreenshot(outcome, ctx)) {
          const inst = INSTANCES.get(instanceKey(ctx));
          if (inst) {
            const shot = await captureInlineScreenshot(inst.page, ctx, outcome.fullPage === true);
            if (shot) {
              // `savedPath` is an extra field pi-ai's serializers ignore but the
              // context-engine uses it to keep the file reachable after the
              // image bytes are stripped from older turns.
              content.push({
                type: 'image',
                mimeType: shot.mimeType,
                data: shot.data,
                savedPath: shot.savedPath,
              } as (typeof content)[number]);
              extraText = `\n(Screenshot saved to ${shot.savedPath})`;
            }
          }
        }
        if (shouldAddBrowserNotices(action)) {
          extraText += await pageNoticesText(ctx);
        }
        content.push({ type: 'text', text: outcome.text + extraText });
        return { content, details: undefined };
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

// Exported for tests — shuts down any running instances so test isolation works.
export async function __resetBrowsersForTests(): Promise<void> {
  const instances = [...INSTANCES.values()];
  INSTANCES.clear();
  await Promise.all(instances.map((i) => teardownInstance(i)));
}
