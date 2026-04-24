import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { chromium, type BrowserContext, type Page } from 'playwright';

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_PROFILE_DIR = '.browser-profile';
const SCREENSHOT_DIR = 'browser-screenshots';
const MAX_TEXT_CHARS = 12_000;

export interface BrowserToolContext {
  cwd: string;
  /** Absolute or cwd-relative path for the persistent profile. Empty = <cwd>/.browser-profile. */
  userDataDir: string;
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
    headless: true,
    viewport,
  });
  context.setDefaultTimeout(ctx.defaultTimeoutMs);

  // launchPersistentContext always opens one page on start; reuse it.
  const page = context.pages()[0] ?? (await context.newPage());

  const instance: BrowserInstance = {
    context,
    page,
    userDataDir,
    startedAt: Date.now(),
  };
  INSTANCES.set(key, instance);
  return instance;
}

function truncate(s: string, max = MAX_TEXT_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...(${s.length - max} chars truncated)`;
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
  const snap = await inst.page.accessibility.snapshot({ interestingOnly: true });
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
      'Browser running (headless).',
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

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Drive a real Chromium browser (headless) to read and interact with live web pages.',
  'A persistent profile survives across calls so logins and cookies stick.',
  'By default, every state-changing action also returns a screenshot so the user can watch progress.',
  '',
  'Actions:',
  '  navigate    — go to a URL. Auto-launches the browser on first use. Params: url.',
  '  click       — click an element. Params: selector (CSS, or Playwright text="..." locator).',
  '  type        — fill an input. Params: selector, text.',
  '  key         — press a key. Params: key (e.g. "Enter"), selector? (focus first).',
  '  text        — return innerText. Params: selector? (omit for whole page body).',
  '  evaluate    — run JS inside the page and return the result. Params: expression.',
  '  snapshot    — accessibility tree (compact, structured view of interactive elements).',
  '  screenshot  — save a PNG under <cwd>/browser-screenshots/ and return the image inline. Params: fullPage?',
  '  back / forward / reload — history navigation.',
  '  status      — whether the browser is running, current URL, uptime.',
  '  close       — shut down the browser (profile is kept).',
  '',
  'Typical loop: navigate → snapshot (or screenshot + vision) → click/type with the selector you found.',
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
    description: DESCRIPTION,
    label: 'Browser',
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal('navigate'),
          Type.Literal('click'),
          Type.Literal('type'),
          Type.Literal('key'),
          Type.Literal('text'),
          Type.Literal('evaluate'),
          Type.Literal('snapshot'),
          Type.Literal('screenshot'),
          Type.Literal('back'),
          Type.Literal('forward'),
          Type.Literal('reload'),
          Type.Literal('status'),
          Type.Literal('close'),
        ],
        { description: 'Which browser operation to perform' },
      ),
      url: Type.Optional(Type.String({ description: 'Target URL (navigate)' })),
      selector: Type.Optional(
        Type.String({
          description:
            'Playwright selector (CSS / text="..." / role=...). Required for click/type/key; optional for text.',
        }),
      ),
      text: Type.Optional(Type.String({ description: 'Text to fill (type)' })),
      key: Type.Optional(Type.String({ description: 'Key name, e.g. "Enter" (key)' })),
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
          case 'click':      outcome = await doClick(params, ctx); break;
          case 'type':       outcome = await doType(params, ctx); break;
          case 'key':        outcome = await doKey(params, ctx); break;
          case 'text':       outcome = await doText(params, ctx); break;
          case 'evaluate':   outcome = await doEvaluate(params, ctx); break;
          case 'snapshot':   outcome = await doSnapshot(params, ctx); break;
          case 'screenshot': outcome = await doScreenshot(params, ctx); break;
          case 'back':       outcome = await doBack(params, ctx); break;
          case 'forward':    outcome = await doForward(params, ctx); break;
          case 'reload':     outcome = await doReload(params, ctx); break;
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
