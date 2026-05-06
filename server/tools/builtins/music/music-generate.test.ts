import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createMusicGenerateTool } from './music-generate';
import { createAgentTools } from '../../tool-factory';
import { initializeToolRegistry } from '../../tool-registry';

beforeAll(async () => {
  await initializeToolRegistry();
});

let tmpDir: string;

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-music-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('music_generate registration', () => {
  it('creates the tool even without any keys (list will show nothing)', () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir });
    expect(tool.name).toBe('music_generate');
    expect(tool.label).toBe('Music Generate');
  });

  it('is registered by createAgentTools when music_generate is in names and cwd is set', () => {
    const tools = createAgentTools(['music_generate'], [], undefined, { cwd: tmpDir });
    expect(tools.map((t) => t.name)).toContain('music_generate');
  });
});

describe('music_generate.list', () => {
  it('returns a helpful message when no providers are configured', async () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).toContain('No music generation providers');
  });

  it('lists every configured provider', async () => {
    const tool = createMusicGenerateTool({
      cwd: tmpDir,
      geminiApiKey: 'g1',
      minimaxApiKey: 'm1',
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).toContain('google');
    expect(out).toContain('minimax');
  });

  it('honours the preferred provider order', async () => {
    const tool = createMusicGenerateTool({
      cwd: tmpDir,
      geminiApiKey: 'g1',
      minimaxApiKey: 'm1',
      preferredProvider: 'minimax',
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    const miniIdx = out.indexOf('minimax');
    const googleIdx = out.indexOf('google');
    expect(miniIdx).toBeGreaterThan(-1);
    expect(googleIdx).toBeGreaterThan(-1);
    expect(miniIdx).toBeLessThan(googleIdx);
  });
});

describe('music_generate.generate', () => {
  it('refuses to generate without configured providers', async () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir });
    await expect(
      tool.execute('t1', { action: 'generate', prompt: 'soft piano' }),
    ).rejects.toThrow(/No music generation providers/);
  });

  it('rejects empty prompt', async () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir, minimaxApiKey: 'k' });
    await expect(
      tool.execute('t1', { action: 'generate', prompt: '   ' }),
    ).rejects.toThrow(/prompt is required/);
  });

  it('rejects a request for an unconfigured provider', async () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir, minimaxApiKey: 'k' });
    await expect(
      tool.execute('t1', {
        action: 'generate',
        prompt: 'soft piano',
        provider: 'google',
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('rejects lyrics for a provider that does not support them', async () => {
    const tool = createMusicGenerateTool({ cwd: tmpDir, geminiApiKey: 'k' });
    await expect(
      tool.execute('t1', {
        action: 'generate',
        prompt: 'soft piano',
        provider: 'google',
        lyrics: 'la la la',
      }),
    ).rejects.toThrow(/does not support lyrics/);
  });

  it('generates via Google Lyria and writes a WAV into music/', async () => {
    const audio = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        predictions: [
          { bytesBase64Encoded: audio.toString('base64'), mimeType: 'audio/wav' },
        ],
      }),
    );

    const tool = createMusicGenerateTool({
      cwd: tmpDir,
      geminiApiKey: 'g-key',
      preferredProvider: 'google',
    });
    const out = text(
      await tool.execute('t1', {
        action: 'generate',
        prompt: 'cinematic orchestral score',
        duration: 20,
        filename: 'scene1',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('lyria-002:predict');
    expect(url).toContain('key=g-key');
    const body = JSON.parse(init.body as string);
    expect(body.instances[0].prompt).toBe('cinematic orchestral score');
    expect(body.parameters.durationSeconds).toBe(20);

    expect(out).toContain(`Saved to: ${path.join('music', 'scene1.wav')}`);
    const saved = await fs.readFile(path.join(tmpDir, 'music', 'scene1.wav'));
    expect(saved.equals(audio)).toBe(true);
  });

  it('generates via MiniMax Music, decodes hex audio, and forwards lyrics', async () => {
    const rawBytes = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: { audio: rawBytes.toString('hex') },
        base_resp: { status_code: 0 },
      }),
    );

    const tool = createMusicGenerateTool({
      cwd: tmpDir,
      minimaxApiKey: 'mm-key',
      minimaxGroupId: 'grp-42',
    });
    await tool.execute('t1', {
      action: 'generate',
      prompt: 'upbeat pop song about sunshine',
      lyrics: 'The sun is shining today',
      provider: 'minimax',
      filename: 'sunshine',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.minimax.chat/v1/music_generation?GroupId=grp-42');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mm-key');
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe('upbeat pop song about sunshine');
    expect(body.lyrics).toBe('The sun is shining today');
    expect(body.audio_setting.format).toBe('mp3');

    const saved = await fs.readFile(path.join(tmpDir, 'music', 'sunshine.mp3'));
    expect(saved.equals(rawBytes)).toBe(true);
  });

  it('surfaces MiniMax status errors returned in base_resp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        base_resp: { status_code: 1000, status_msg: 'invalid prompt' },
      }),
    );

    const tool = createMusicGenerateTool({ cwd: tmpDir, minimaxApiKey: 'mm' });
    await expect(
      tool.execute('t1', { action: 'generate', prompt: 'x', provider: 'minimax' }),
    ).rejects.toThrow(/MiniMax Music: invalid prompt/);
  });

  it('surfaces Google Lyria HTTP error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Permission denied', { status: 403 }),
    );

    const tool = createMusicGenerateTool({ cwd: tmpDir, geminiApiKey: 'bad' });
    await expect(
      tool.execute('t1', { action: 'generate', prompt: 'jazz trio' }),
    ).rejects.toThrow(/Google Lyria error 403/);
  });
});
