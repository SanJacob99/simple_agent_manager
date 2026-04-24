import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { chromium, type BrowserContext, type Page } from 'playwright';

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_PROFILE_DIR = '.browser-profile';
const SCREENSHOT_DIR = 'browser-screenshots';
const MAX_TEXT_CHARS = 12_000;
const MAX_OBSERVE_TEXT_CHARS = 4_000;
const MAX_INTERACTIVE_ELEMENTS = 80;
const DEFAULT_SCROLL_PIXELS = 650;

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
}

interface BrowserInstance {
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  headless: boolean;
  startedAt: number;
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

async function getOrLaunch(ctx: BrowserToolContext): Promise<BrowserInstance> {
  const key = instanceKey(ctx);
  const existing = INSTANCES.get(key);
  if (existing) return existing;

  const userDataDir = resolveUserDataDir(ctx);
  await fs.mkdir(userDataDir, { recursive: true });

  const viewport = {
    width: ctx.viewportWidth > 0 ? ctx.viewportWidth : DEFAULT_VIEWPORT.width,
    height: ctx.viewportHeight > 0 ? ctx.viewportHeight : DEFAULT_VIEWPORT.height,
  };

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: ctx.headless,
    viewport,
  });
  context.setDefaultTimeout(ctx.defaultTimeoutMs);

  // launchPersistentContext always opens one page on start; reuse it.
  const page = context.pages()[0] ?? (await context.newPage());

  const instance: BrowserInstance = {
    context,
    page,
    userDataDir,
    headless: ctx.headless,
    startedAt: Date.now(),
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
  const page = inst.context.pages().find((candidate) => !candidate.isClosed())
    ?? (await inst.context.newPage());
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
      'Possible bot protection, CAPTCHA, or access challenge visible. Do not bypass it; ask the user to take over or choose another allowed source.',
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
  await inst.context.close().catch(() => {});
  return {
    text: `Browser closed. Profile preserved at ${inst.userDataDir}`,
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
  return {
    text: [
      `Browser running (${inst.headless ? 'headless' : 'visible window'}).`,
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

async function doListTabs(_params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const pages = inst.context.pages();
  const active = await activePage(inst);
  const lines = await Promise.all(
    pages.map(async (page, index) => {
      const title = await page.title().catch(() => '');
      const marker = page === active ? '*' : ' ';
      return `${marker} [${index}] ${page.url()}${title ? ` - ${title}` : ''}`;
    }),
  );
  return { text: lines.join('\n'), attach: 'none' };
}

async function doNewTab(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const page = await inst.context.newPage();
  inst.page = page;
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (url) {
    await page.goto(url, { timeout: ctx.defaultTimeoutMs, waitUntil: 'domcontentloaded' });
  }
  const title = await page.title().catch(() => '');
  return { text: `Opened tab ${inst.context.pages().indexOf(page)} at ${page.url()}${title ? ` - ${title}` : ''}`, attach: 'auto' };
}

async function doSwitchTab(params: any, ctx: BrowserToolContext): Promise<ActionResult> {
  const inst = await getOrLaunch(ctx);
  const pages = inst.context.pages();
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
  const pages = inst.context.pages();
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
  await target.close().catch(() => {});
  const remaining = inst.context.pages().filter((page) => !page.isClosed());
  inst.page = remaining[Math.min(rawIndex, remaining.length - 1)] ?? (await inst.context.newPage());
  return { text: `Closed tab ${rawIndex}. Active tab is now ${inst.page.url()}`, attach: 'auto' };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const BROWSER_DESCRIPTION = [
  'Drive a real Chromium browser (headless by default, optionally visible) to read and interact with live web pages for user-directed tasks.',
  'Use it for browsing, research, comparing products/listings, coupon hunting, reservations, forms, and JavaScript-heavy pages.',
  'A persistent profile survives across calls so cookies, tabs, and login state stick.',
  'By default, every state-changing action also returns a screenshot so the user can watch progress.',
  '',
  'Respectful-use policy:',
  '  - Do not bypass CAPTCHA, bot protection, paywalls, access controls, or site blocks. Ask the user to take over or choose another source.',
  '  - Do not ask for passwords, one-time codes, payment cards, or other secrets in chat. Hand those steps to the user in the browser; if running headless, explain that visible-browser mode or another authorized source is needed.',
  '  - Before final submissions that commit the user (reservation, purchase, payment, message, appointment, cancellation, account change), call confirm_action and wait for yes.',
  '  - Publicly shown coupon codes may be tried; do not brute-force coupon endpoints or generate/guess codes at scale.',
  '',
  'Actions:',
  '  navigate    - go to a URL. Auto-launches the browser on first use. Params: url.',
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
  '',
  'Typical loop: navigate -> observe (or screenshot + vision) -> click/type/select/check -> wait/observe.',
  'Playwright selectors: CSS (`.cls`, `#id`, `a[href*="foo"]`), text (`text="Sign in"`), role (`role=button[name="Submit"]`).',
].join('\n');

function attachesScreenshot(outcome: ActionResult, ctx: BrowserToolContext): boolean {
  if (outcome.attach === 'force') return true;
  if (outcome.attach === 'auto') return ctx.autoScreenshot;
  return false;
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
        ],
        { description: 'Which browser operation to perform' },
      ),
      url: Type.Optional(Type.String({ description: 'Target URL (navigate)' })),
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
    }),
    execute: async (_toolCallId, params: any, signal): Promise<AgentToolResult<undefined>> => {
      const action = String(params?.action ?? '').trim();
      if (!action) throw new Error('action is required');

      if (signal?.aborted) {
        return { content: [{ type: 'text', text: '[aborted before execution]' }], details: undefined };
      }

      // Register an abort handler that closes the browser. Playwright's
      // actions don't take a signal, so the cleanest cancellation we
      // have is "tear it all down" — the next tool call will relaunch.
      const onAbort = () => {
        const key = instanceKey(ctx);
        const inst = INSTANCES.get(key);
        if (!inst) return;
        INSTANCES.delete(key);
        inst.context.close().catch(() => {});
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        let outcome: ActionResult;
        switch (action) {
          case 'navigate':   outcome = await doNavigate(params, ctx); break;
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
  await Promise.all(
    instances.map((i) => i.context.close().catch(() => {})),
  );
}
