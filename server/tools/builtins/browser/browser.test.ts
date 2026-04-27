import { describe, expect, it } from 'vitest';
import {
  BROWSER_ACTION_CLASSIFICATION,
  buildGateQuestion,
  gateIfWriting,
  inferBrowserNotices,
  type BrowserToolContext,
} from './browser';
import { HitlRegistry } from '../../../hitl/hitl-registry';
import type { AskUserContext } from '../human/ask-user';

function baseCtx(overrides: Partial<BrowserToolContext> = {}): BrowserToolContext {
  return {
    cwd: '',
    userDataDir: '',
    headless: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    defaultTimeoutMs: 30_000,
    autoScreenshot: true,
    screenshotFormat: 'jpeg',
    screenshotQuality: 60,
    stealth: false,
    ...overrides,
  };
}

function makeHitl(registry: HitlRegistry): AskUserContext {
  return {
    agentId: 'test-agent',
    getSessionKey: () => 'test-session',
    registry,
    emit: () => {},
  };
}

describe('browser tool notices', () => {
  it('detects bot protection and CAPTCHA language', () => {
    const notices = inferBrowserNotices('Checking your browser before accessing the site. CAPTCHA required.');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Possible bot protection/);
  });

  it('includes the actionable retry playbook in the bot-protection notice', () => {
    const [notice] = inferBrowserNotices('Please complete the CAPTCHA to continue.');
    expect(notice).toMatch(/action="search"/);
    expect(notice).toMatch(/web_search|web_fetch/);
    expect(notice).toMatch(/ask_user/);
  });

  it('detects credential and payment steps', () => {
    const notices = inferBrowserNotices('Log in with your password. Enter credit card number and CVV.');
    expect(notices).toEqual([
      expect.stringContaining('Possible login'),
      expect.stringContaining('Possible payment'),
    ]);
  });

  it('detects commitment steps that need confirmation', () => {
    expect(inferBrowserNotices('Reserve now or confirm reservation for Friday at 7 PM.')).toEqual([
      expect.stringContaining('Possible commitment'),
    ]);
  });

  it('returns no notices for ordinary research pages', () => {
    expect(inferBrowserNotices('Black holes form when massive stars collapse.')).toEqual([]);
  });
});

describe('BROWSER_ACTION_CLASSIFICATION', () => {
  it('marks all read-only actions as read-only', () => {
    const readOnly = [
      'navigate', 'search', 'observe', 'text', 'snapshot', 'screenshot',
      'scroll', 'wait', 'status', 'list_tabs', 'back', 'forward', 'reload',
    ];
    for (const action of readOnly) {
      expect(BROWSER_ACTION_CLASSIFICATION[action]).toBe('read-only');
    }
  });

  it('marks committing actions as state-mutating', () => {
    const writing = [
      'click', 'type', 'key', 'select', 'check', 'evaluate',
      'new_tab', 'switch_tab', 'close_tab', 'close', 'handover',
    ];
    for (const action of writing) {
      expect(BROWSER_ACTION_CLASSIFICATION[action]).toBe('state-mutating');
    }
  });
});

describe('buildGateQuestion', () => {
  const ctx = baseCtx();

  it('names the selector and URL for click', () => {
    const q = buildGateQuestion('click', { selector: 'role=button[name="Buy"]' }, ctx);
    expect(q).toMatch(/click/);
    expect(q).toContain('role=button[name="Buy"]');
  });

  it('includes the typed text preview for type', () => {
    const q = buildGateQuestion('type', { selector: '#q', text: 'hello world' }, ctx);
    expect(q).toMatch(/type "hello world"/);
    expect(q).toContain('`#q`');
  });

  it('truncates long text in the question', () => {
    const longText = 'x'.repeat(200);
    const q = buildGateQuestion('type', { selector: '#q', text: longText }, ctx);
    expect(q).toMatch(/…/);
  });

  it('describes check vs uncheck', () => {
    expect(buildGateQuestion('check', { selector: '#agree' }, ctx)).toMatch(/\bcheck\b/);
    expect(buildGateQuestion('check', { selector: '#agree', checked: false }, ctx)).toMatch(/uncheck/);
  });

  it('labels handover as a takeover request with reason and instructions', () => {
    const q = buildGateQuestion(
      'handover',
      { reason: 'captcha', instructions: 'solve the Turnstile' },
      ctx,
    );
    expect(q).toMatch(/take over/i);
    expect(q).toMatch(/captcha/);
    expect(q).toMatch(/solve the Turnstile/);
  });

  it('mentions closing the session for close', () => {
    expect(buildGateQuestion('close', {}, ctx)).toMatch(/shut down|close/i);
  });
});

describe('gateIfWriting', () => {
  it('proceeds immediately for read-only actions', async () => {
    const ctx = baseCtx({ hitl: makeHitl(new HitlRegistry()) });
    const outcome = await gateIfWriting('call-1', 'observe', {}, ctx, undefined);
    expect(outcome).toEqual({ proceed: true });
  });

  it('proceeds silently when no HITL context is wired', async () => {
    const ctx = baseCtx();
    const outcome = await gateIfWriting('call-1', 'click', { selector: '#a' }, ctx, undefined);
    expect(outcome).toEqual({ proceed: true });
  });

  it('blocks and returns a declined result when the user answers no', async () => {
    const registry = new HitlRegistry();
    const ctx = baseCtx({ hitl: makeHitl(registry) });

    const gated = gateIfWriting('call-1', 'click', { selector: '#buy' }, ctx, undefined);
    // Give the microtask queue a chance to register the entry.
    await new Promise((r) => setTimeout(r, 0));
    registry.resolve('test-agent', 'test-session', 'call-1', { kind: 'confirm', answer: 'no' });

    const outcome = await gated;
    expect(outcome.proceed).toBe(false);
    if (outcome.proceed === false) {
      expect(outcome.result.content[0]).toMatchObject({ type: 'text' });
      const text = (outcome.result.content[0] as { text: string }).text;
      expect(text).toMatch(/not approved/);
      expect(text).toMatch(/do not retry/i);
    }
  });

  it('proceeds when the user answers yes', async () => {
    const registry = new HitlRegistry();
    const ctx = baseCtx({ hitl: makeHitl(registry) });

    const gated = gateIfWriting('call-2', 'type', { selector: '#q', text: 'hi' }, ctx, undefined);
    await new Promise((r) => setTimeout(r, 0));
    registry.resolve('test-agent', 'test-session', 'call-2', { kind: 'confirm', answer: 'yes' });

    const outcome = await gated;
    expect(outcome).toEqual({ proceed: true });
  });

  it('returns declined when the gate is cancelled (e.g. timeout)', async () => {
    const registry = new HitlRegistry();
    const ctx = baseCtx({ hitl: makeHitl(registry) });

    const gated = gateIfWriting('call-3', 'close', {}, ctx, undefined);
    await new Promise((r) => setTimeout(r, 0));
    registry.cancelAllForSession('test-agent', 'test-session', 'timeout');

    const outcome = await gated;
    expect(outcome.proceed).toBe(false);
    if (outcome.proceed === false) {
      const text = (outcome.result.content[0] as { text: string }).text;
      expect(text).toMatch(/timeout/);
    }
  });
});
