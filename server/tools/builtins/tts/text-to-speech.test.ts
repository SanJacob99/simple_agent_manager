import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createTextToSpeechTool } from './text-to-speech';
import { createAgentTools } from '../../tool-factory';
import { initializeToolRegistry } from '../../tool-registry';

beforeAll(async () => {
  await initializeToolRegistry();
});

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
    const result = await tool.execute('t1', {
      action: 'speak',
      text: 'hello world',
      filename: 'greeting',
    });
    const out = text(result);

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

    // The tool ships the audio bytes inline so the chat drawer can play them.
    const details = (result as any).details;
    expect(details?.audio?.mimeType).toBe('audio/mpeg');
    expect(details?.audio?.data).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
    expect(details?.audio?.path).toBe('audio/greeting.mp3');
    expect(details?.audio?.filename).toBe('greeting.mp3');
    expect(details?.audio?.provider).toBe('openai');
    expect(details?.audio?.transcript).toBe('hello world');
  });

  it('leaves details undefined for action="list"', async () => {
    const tool = createTextToSpeechTool({ cwd: tmpDir, openaiApiKey: 'k' });
    const result = await tool.execute('t1', { action: 'list' });
    expect((result as any).details).toBeUndefined();
  });

  it('ships a WAV-wrapped copy in details.audio when the requested format is PCM', async () => {
    // OpenAI PCM is 24 kHz mono 16-bit — raw bytes are unplayable in the
    // browser, so the chat-drawer payload must carry a WAV-wrapped copy.
    const rawPcm = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(rawPcm, {
        status: 200,
        headers: { 'Content-Type': 'audio/L16' },
      }),
    );

    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      openaiApiKey: 'key',
      preferredProvider: 'openai',
    });
    const result = await tool.execute('t1', {
      action: 'speak',
      text: 'hello pcm',
      format: 'pcm',
      filename: 'raw',
    });

    // Saved file on disk stays as raw .pcm — external tools still get
    // what they asked for.
    const onDisk = await fs.readFile(path.join(tmpDir, 'audio', 'raw.pcm'));
    expect(onDisk.equals(rawPcm)).toBe(true);

    // UI payload is WAV-wrapped.
    const details = (result as any).details;
    expect(details?.audio?.mimeType).toBe('audio/wav');
    const wav = Buffer.from(details.audio.data, 'base64');
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    // 44-byte header + raw payload.
    expect(wav.length).toBe(44 + rawPcm.length);
    // Sample-rate field at offset 24 should be 24000 for OpenAI PCM.
    expect(wav.readUInt32LE(24)).toBe(24000);
    // Path on disk still references the .pcm extension.
    expect(details?.audio?.path).toBe('audio/raw.pcm');
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

describe('text_to_speech.openrouter', () => {
  function sseChunk(json: unknown): string {
    return `data: ${JSON.stringify(json)}\n\n`;
  }

  it('appears in the provider list when the lazy resolver returns a key', async () => {
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      getOpenrouterApiKey: () => 'or-key',
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).toContain('openrouter');
  });

  it('skips the provider when the lazy resolver returns undefined', async () => {
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      getOpenrouterApiKey: async () => undefined,
    });
    const out = text(await tool.execute('t1', { action: 'list' }));
    expect(out).not.toContain('openrouter');
  });

  it('streams audio chunks back through the chat-completions SSE response', async () => {
    const part1 = Buffer.from([0x01, 0x02]);
    const part2 = Buffer.from([0x03, 0x04, 0x05]);
    const body =
      sseChunk({
        choices: [
          { delta: { audio: { data: part1.toString('base64') } } },
        ],
      }) +
      sseChunk({
        choices: [
          { delta: { audio: { data: part2.toString('base64') } } },
        ],
      }) +
      'data: [DONE]\n\n';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      getOpenrouterApiKey: () => 'or-key',
    });
    await tool.execute('t1', {
      action: 'speak',
      text: 'hello via openrouter',
      provider: 'openrouter',
      filename: 'or',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer or-key');
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('openai/gpt-4o-audio-preview');
    expect(sent.modalities).toEqual(['text', 'audio']);
    expect(sent.audio).toEqual({ voice: 'alloy', format: 'mp3' });
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].content).toContain('hello via openrouter');
    expect(sent.messages[0].content).toMatch(/verbatim/i);

    const saved = await fs.readFile(path.join(tmpDir, 'audio', 'or.mp3'));
    expect(saved.equals(Buffer.concat([part1, part2]))).toBe(true);
  });

  it('maps pcm and ogg formats onto OpenRouter wire formats (pcm16, opus)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        sseChunk({
          choices: [
            { delta: { audio: { data: Buffer.from([0xaa]).toString('base64') } } },
          ],
        }) + 'data: [DONE]\n\n',
        { status: 200 },
      ),
    );
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      getOpenrouterApiKey: () => 'or-key',
    });
    await tool.execute('t1', {
      action: 'speak',
      text: 'x',
      provider: 'openrouter',
      format: 'pcm',
      filename: 'p',
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent.audio.format).toBe('pcm16');
  });

  it('surfaces a clear error when the SSE stream contains no audio chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        sseChunk({ choices: [{ delta: { content: 'no audio here' } }] }) +
          'data: [DONE]\n\n',
        { status: 200 },
      ),
    );
    const tool = createTextToSpeechTool({
      cwd: tmpDir,
      getOpenrouterApiKey: () => 'or-key',
    });
    await expect(
      tool.execute('t1', {
        action: 'speak',
        text: 'x',
        provider: 'openrouter',
      }),
    ).rejects.toThrow(/no audio payload/);
  });
});
