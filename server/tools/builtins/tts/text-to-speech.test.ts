import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createTextToSpeechTool } from './text-to-speech';
import { createAgentTools } from '../../tool-factory';

let tmpDir: string;

function text(result: { content: { type: string; text?: string }[] }): string {
  return (result.content[0] as { text: string }).text;
}

function audioResponse(bytes: Uint8Array, contentType = 'audio/mpeg'): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-tts-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('text_to_speech registration', () => {
  it('creates the tool even without any keys (list will show nothing)', () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir });
    expect(tool.name).toBe('text_to_speech');
    expect(tool.label).toBe('Text to Speech');
  });

  it('is registered by createAgentTools when text_to_speech is in names and cwd is set', () => {
    const tools = createAgentTools(['text_to_speech'], [], undefined, { cwd: tmpDir });
    expect(tools.map((t) => t.name)).toContain('text_to_speech');
  });

  it('is skipped when cwd is missing', () => {
    const tools = createAgentTools(['text_to_speech'], [], undefined, {});
    expect(tools.map((t) => t.name)).not.toContain('text_to_speech');
  });
});

describe('text_to_speech.list', () => {
  it('returns a helpful message when no providers are configured', async () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).toContain('No TTS providers');
  });

  it('lists every configured provider', async () => {
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      openaiApiKey: 'k1',
      elevenLabsApiKey: 'k2',
      geminiApiKey: 'k3',
      microsoftApiKey: 'k4',
      microsoftRegion: 'eastus',
      minimaxApiKey: 'k5',
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).toContain('openai');
    expect(out).toContain('elevenlabs');
    expect(out).toContain('google');
    expect(out).toContain('microsoft');
    expect(out).toContain('minimax');
  });

  it('skips microsoft when the region is missing', async () => {
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      microsoftApiKey: 'k4',
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).not.toContain('microsoft');
  });
});

describe('text_to_speech.speak', () => {
  it('refuses to speak without configured providers', async () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir });
    await expect(tool.execute('t1', { action: 'speak', text: 'hi' })).rejects.toThrow(
      /No TTS providers/,
    );
  });

  it('rejects empty text', async () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir, openaiApiKey: 'k' });
    await expect(tool.execute('t1', { action: 'speak', text: '   ' })).rejects.toThrow(
      /text is required/,
    );
  });

  it('rejects a request for an unconfigured provider', async () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir, openaiApiKey: 'k' });
    await expect(
      tool.execute('t1', { action: 'speak', text: 'hi', provider: 'elevenlabs' }),
    ).rejects.toThrow(/not configured/);
  });

  it('rejects a format the chosen provider does not support', async () => {
    // ElevenLabs only supports mp3 + pcm
    const tool = createTextToSpeechTool({ cwd: tmpDir, elevenLabsApiKey: 'k' });
    await expect(
      tool.execute('t1', {
        action: 'speak',
        text: 'hi',
        provider: 'elevenlabs',
        format: 'wav',
      }),
    ).rejects.toThrow(/does not support format/);
  });

  it('synthesizes via OpenAI and writes the MP3 to audio/', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(audioResponse(new Uint8Array([1, 2, 3, 4])));

    const tool = createTextToSpeechTool({ cwd: tmpDir, openaiApiKey: 'key', preferredProvider: 'openai' });
    const out = text(
      await tool.execute('t1', {
        action: 'speak',
        text: 'hello world',
        filename: 'greeting',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
    const body = JSON.parse(init.body as string);
    expect(body.input).toBe('hello world');
    expect(body.response_format).toBe('mp3');
    expect(body.voice).toBe('alloy');

    expect(out).toContain('Saved to: audio/greeting.mp3');
    const written = await fs.readFile(path.join(tmpDir, 'audio', 'greeting.mp3'));
    expect(written.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  it('routes to ElevenLabs when requested and uses xi-api-key header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(audioResponse(new Uint8Array([9, 9, 9])));

    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      elevenLabsApiKey: 'el-key',
      openaiApiKey: 'openai-key',
    });
    await tool.execute('t1', {
      action: 'speak',
      text: 'hi',
      provider: 'elevenlabs',
      voice: 'abc-voice',
      filename: 'eleven',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.elevenlabs.io/v1/text-to-speech/abc-voice');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('el-key');
    const saved = await fs.readFile(path.join(tmpDir, 'audio', 'eleven.mp3'));
    expect(saved.length).toBe(3);
  });

  it('wraps Google Gemini PCM output in a WAV header when wav is requested', async () => {
    const pcm = Buffer.alloc(200, 7);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;rate=24000',
                    data: pcm.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const tool = createTextToSpeechTool({ cwd: tmpDir, geminiApiKey: 'g-key' });
    await tool.execute('t1', {
      action: 'speak',
      text: 'hola',
      provider: 'google',
      filename: 'g',
    });

    const saved = await fs.readFile(path.join(tmpDir, 'audio', 'g.wav'));
    expect(saved.length).toBe(200 + 44);
    expect(saved.subarray(0, 4).toString()).toBe('RIFF');
    expect(saved.subarray(8, 12).toString()).toBe('WAVE');
  });

  it('Microsoft Azure uses SSML and the correct regional endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(audioResponse(new Uint8Array([0xff, 0xfb, 0x00])));

    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      microsoftApiKey: 'az-key',
      microsoftRegion: 'westeurope',
      microsoftDefaultVoice: 'en-GB-SoniaNeural',
    });
    await tool.execute('t1', {
      action: 'speak',
      text: 'the <quick> & brown fox',
      provider: 'microsoft',
      filename: 'az',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('az-key');
    const body = init.body as string;
    expect(body).toContain("xml:lang='en-GB'");
    expect(body).toContain('en-GB-SoniaNeural');
    expect(body).toContain('&lt;quick&gt;');
    expect(body).toContain('&amp;');
  });

  it('MiniMax decodes hex audio payloads into bytes', async () => {
    const rawBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: { audio: rawBytes.toString('hex') },
        base_resp: { status_code: 0 },
      }),
    );

    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      minimaxApiKey: 'mm-key',
      minimaxGroupId: 'grp123',
    });
    await tool.execute('t1', {
      action: 'speak',
      text: 'hi',
      provider: 'minimax',
      filename: 'mm',
    });
    const saved = await fs.readFile(path.join(tmpDir, 'audio', 'mm.mp3'));
    expect(saved.equals(rawBytes)).toBe(true);
  });

  it('surfaces provider error responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Invalid key', { status: 401 }),
    );

    const tool = createTextToSpeechTool({ cwd: tmpDir, openaiApiKey: 'bad' });
    await expect(
      tool.execute('t1', { action: 'speak', text: 'hi' }),
    ).rejects.toThrow(/OpenAI TTS error 401/);
  });
});
