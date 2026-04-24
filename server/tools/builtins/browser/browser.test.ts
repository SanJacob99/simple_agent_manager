import { describe, expect, it } from 'vitest';
import { inferBrowserNotices } from './browser';

describe('browser tool notices', () => {
  it('detects bot protection and CAPTCHA language', () => {
    expect(inferBrowserNotices('Checking your browser before accessing the site. CAPTCHA required.')).toEqual([
      expect.stringContaining('Possible bot protection'),
    ]);
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
