import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveUserToolsDir } from './resolve-user-tools-dir';

describe('resolveUserToolsDir', () => {
  it('defaults to server/tools/user/ (absolute path) with no env set', () => {
    const info = resolveUserToolsDir({});
    expect(info.dirs).toHaveLength(1);
    expect(path.isAbsolute(info.dirs[0])).toBe(true);
    expect(info.dirs[0].endsWith(path.join('server', 'tools', 'user'))).toBe(true);
    expect(info.describe).toContain('default');
  });

  it('returns zero dirs when SAM_DISABLE_USER_TOOLS=1', () => {
    const info = resolveUserToolsDir({ SAM_DISABLE_USER_TOOLS: '1' });
    expect(info.dirs).toEqual([]);
    expect(info.describe).toContain('disabled');
  });

  it('ignores SAM_DISABLE_USER_TOOLS when the value is not exactly "1"', () => {
    // Strict-equality kill switch avoids surprise from stray `true` / `yes`.
    const info = resolveUserToolsDir({ SAM_DISABLE_USER_TOOLS: 'true' });
    expect(info.dirs).toHaveLength(1);
  });

  it('honours SAM_USER_TOOLS_DIR as a single override directory', () => {
    const info = resolveUserToolsDir({ SAM_USER_TOOLS_DIR: '/opt/team/tools' });
    expect(info.dirs).toEqual(['/opt/team/tools']);
    expect(info.describe).toContain('/opt/team/tools');
  });

  it('trims whitespace in SAM_USER_TOOLS_DIR', () => {
    const info = resolveUserToolsDir({ SAM_USER_TOOLS_DIR: '  /tmp/tools  ' });
    expect(info.dirs).toEqual(['/tmp/tools']);
  });

  it('expands a leading ~/ in SAM_USER_TOOLS_DIR', () => {
    const info = resolveUserToolsDir({ SAM_USER_TOOLS_DIR: '~/my-tools' });
    expect(info.dirs).toEqual([path.join(os.homedir(), 'my-tools')]);
  });

  it('expands a bare ~ in SAM_USER_TOOLS_DIR', () => {
    const info = resolveUserToolsDir({ SAM_USER_TOOLS_DIR: '~' });
    expect(info.dirs).toEqual([os.homedir()]);
  });

  it('the disable kill switch wins over an override', () => {
    const info = resolveUserToolsDir({
      SAM_DISABLE_USER_TOOLS: '1',
      SAM_USER_TOOLS_DIR: '/ignored',
    });
    expect(info.dirs).toEqual([]);
  });

  it('treats an empty SAM_USER_TOOLS_DIR as "no override"', () => {
    const info = resolveUserToolsDir({ SAM_USER_TOOLS_DIR: '   ' });
    expect(info.dirs).toHaveLength(1);
    expect(info.describe).toContain('default');
  });
});
