import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { wrapPcmAsWav as wrapPcmAsWavBytes } from '../../../../shared/audio-format';

const AUDIO_SUBDIR = 'audio';
const DEFAULT_TIMEOUT_SEC = 60;
const MAX_TEXT_CHARS = 5000;

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

type AudioFormat = 'mp3' | 'wav' | 'pcm' | 'ogg';

interface SpeakRequest {
  text: string;
  voice?: string;
  model?: string;
  format?: AudioFormat;
  signal?: AbortSignal;
}

/**
 * Raw-PCM providers populate this so the tool can wrap the bytes in a
 * WAV header before shipping them to the chat drawer. Browsers can't
 * play raw PCM via `<audio>` — there's no container, no sample rate,
 * no bit depth — so an inline player would show "0:00" and refuse to
 * start. See also `wrapPcmAsWav`.
 */
interface PcmSpec {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

interface SpeakResult {
  audio: Buffer;
  mimeType: string;
  extension: string;
  provider: string;
  model: string;
  voice: string;
  /**
   * Set only when `audio` holds raw PCM. Undefined for container formats
   * (mp3/wav/ogg) — they're directly playable and don't need rewrapping.
   */
  pcm?: PcmSpec;
}

interface TtsProvider {
  id: string;
  name: string;
  defaultModel: string;
  defaultVoice: string;
  supportedFormats: AudioFormat[];
  speak(req: SpeakRequest): Promise<SpeakResult>;
}

function extFor(format: AudioFormat): string {
  return format === 'pcm' ? 'pcm' : format;
}

function mimeFor(format: AudioFormat): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'pcm':
      return 'audio/L16';
  }
}

// ---------------------------------------------------------------------------
// OpenAI TTS
// ---------------------------------------------------------------------------

function createOpenAiTtsProvider(
  apiKey: string,
  opts: { defaultModel?: string; defaultVoice?: string },
): TtsProvider {
  const defaultModel = opts.defaultModel || 'gpt-4o-mini-tts';
  const defaultVoice = opts.defaultVoice || 'alloy';
  return {
    id: 'openai',
    name: 'OpenAI',
    defaultModel,
    defaultVoice,
    supportedFormats: ['mp3', 'wav', 'pcm', 'ogg'],
    async speak(req) {
      const model = req.model || defaultModel;
      const voice = req.voice || defaultVoice;
      const format = req.format || 'mp3';
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          voice,
          input: req.text,
          response_format: format === 'ogg' ? 'opus' : format,
        }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI TTS error ${response.status}: ${text.slice(0, 300)}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        audio: buf,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'openai',
        model,
        voice,
        // OpenAI TTS PCM is 24 kHz, mono, 16-bit signed (per their docs).
        pcm: format === 'pcm' ? { sampleRate: 24000, channels: 1, bitsPerSample: 16 } : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

function createElevenLabsProvider(
  apiKey: string,
  opts: { defaultModel?: string; defaultVoice?: string },
): TtsProvider {
  const defaultModel = opts.defaultModel || 'eleven_multilingual_v2';
  const defaultVoice = opts.defaultVoice || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  return {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    defaultModel,
    defaultVoice,
    supportedFormats: ['mp3', 'pcm'],
    async speak(req) {
      const model = req.model || defaultModel;
      const voice = req.voice || defaultVoice;
      const format = req.format || 'mp3';
      const outputFormat = format === 'pcm' ? 'pcm_16000' : 'mp3_44100_128';
      const url =
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}` +
        `?output_format=${outputFormat}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({ text: req.text, model_id: model }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`ElevenLabs error ${response.status}: ${text.slice(0, 300)}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        audio: buf,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'elevenlabs',
        model,
        voice,
        // ElevenLabs PCM is `pcm_16000` — 16 kHz mono 16-bit signed.
        pcm: format === 'pcm' ? { sampleRate: 16000, channels: 1, bitsPerSample: 16 } : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Google Gemini TTS
// ---------------------------------------------------------------------------

function createGeminiTtsProvider(
  apiKey: string,
  opts: { defaultModel?: string; defaultVoice?: string },
): TtsProvider {
  const defaultModel = opts.defaultModel || 'gemini-2.5-flash-preview-tts';
  const defaultVoice = opts.defaultVoice || 'Kore';
  return {
    id: 'google',
    name: 'Google Gemini',
    defaultModel,
    defaultVoice,
    // Gemini returns 24 kHz PCM; we wrap it in a WAV header by default so it's
    // directly playable. 'pcm' returns the raw bytes.
    supportedFormats: ['wav', 'pcm'],
    async speak(req) {
      const model = req.model || defaultModel;
      const voice = req.voice || defaultVoice;
      const format = req.format === 'pcm' ? 'pcm' : 'wav';
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.text }], role: 'user' }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
          },
        }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Google Gemini TTS error ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
        }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`Google Gemini TTS: ${data.error.message}`);
      const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
        ?.inlineData;
      if (!inline?.data) throw new Error('Google Gemini TTS returned no audio payload');
      const pcm = Buffer.from(inline.data, 'base64');
      const { sampleRate, channels, bitsPerSample } = parseGoogleAudioMime(inline.mimeType);
      if (format === 'pcm') {
        return {
          audio: pcm,
          mimeType: mimeFor('pcm'),
          extension: extFor('pcm'),
          provider: 'google',
          model,
          voice,
          pcm: { sampleRate, channels, bitsPerSample },
        };
      }
      const wav = wrapPcmAsWav(pcm, { sampleRate, channels, bitsPerSample });
      return {
        audio: wav,
        mimeType: mimeFor('wav'),
        extension: extFor('wav'),
        provider: 'google',
        model,
        voice,
      };
    },
  };
}

function parseGoogleAudioMime(mime?: string): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
} {
  const defaults = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  if (!mime) return defaults;
  const rate = mime.match(/rate=(\d+)/);
  if (rate) defaults.sampleRate = Number(rate[1]);
  return defaults;
}

// Thin Buffer-returning shim over the shared typed-array impl. Gemini's
// provider code and the execute() PCM-wrap path both want a `Buffer`.
function wrapPcmAsWav(
  pcm: Buffer,
  opts: { sampleRate: number; channels: number; bitsPerSample: number },
): Buffer {
  return Buffer.from(wrapPcmAsWavBytes(pcm, opts));
}

// ---------------------------------------------------------------------------
// Microsoft Azure TTS
// ---------------------------------------------------------------------------

function createMicrosoftTtsProvider(
  apiKey: string,
  opts: { region: string; defaultVoice?: string },
): TtsProvider {
  const defaultVoice = opts.defaultVoice || 'en-US-JennyNeural';
  return {
    id: 'microsoft',
    name: 'Microsoft Azure',
    defaultModel: 'neural',
    defaultVoice,
    supportedFormats: ['mp3', 'wav'],
    async speak(req) {
      const voice = req.voice || defaultVoice;
      const format = req.format || 'mp3';
      const outputFormat =
        format === 'wav' ? 'riff-24khz-16bit-mono-pcm' : 'audio-24khz-96kbitrate-mono-mp3';
      const locale = voice.split('-').slice(0, 2).join('-') || 'en-US';
      const ssml =
        `<speak version='1.0' xml:lang='${locale}'>` +
        `<voice xml:lang='${locale}' name='${voice}'>${escapeXml(req.text)}</voice>` +
        `</speak>`;
      const url = `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': outputFormat,
          'User-Agent': 'simple-agent-manager',
        },
        body: ssml,
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Microsoft TTS error ${response.status}: ${text.slice(0, 300)}`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return {
        audio: buf,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'microsoft',
        model: 'neural',
        voice,
      };
    },
  };
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// OpenRouter
//
// OpenRouter does NOT have a dedicated TTS endpoint — audio output is
// produced by passing an audio-capable chat model (e.g.
// `openai/gpt-4o-audio-preview`) with `modalities: ["text", "audio"]` and
// `stream: true`. The response is an SSE stream whose `delta.audio.data`
// fields carry base64 chunks that we concatenate into a single buffer.
// We instruct the model to speak the user text verbatim; that keeps the
// behaviour comparable to a real TTS endpoint for most inputs.
// ---------------------------------------------------------------------------

function createOpenRouterTtsProvider(
  apiKey: string,
  opts: { defaultModel?: string; defaultVoice?: string },
): TtsProvider {
  const defaultModel = opts.defaultModel || 'openai/gpt-4o-audio-preview';
  const defaultVoice = opts.defaultVoice || 'alloy';
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel,
    defaultVoice,
    // gpt-4o-audio-preview supports these; other audio-capable models may
    // diverge. We accept the intersection and let the server reject the rest.
    supportedFormats: ['mp3', 'wav', 'pcm', 'ogg'],
    async speak(req) {
      const model = req.model || defaultModel;
      const voice = req.voice || defaultVoice;
      const format = req.format || 'mp3';
      const wireFormat =
        format === 'pcm' ? 'pcm16' : format === 'ogg' ? 'opus' : format;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          modalities: ['text', 'audio'],
          audio: { voice, format: wireFormat },
          stream: true,
          messages: [
            {
              role: 'user',
              content:
                'Speak the following text verbatim, with no additions, ' +
                'commentary, translation, or paraphrasing:\n\n' +
                req.text,
            },
          ],
        }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter TTS error ${response.status}: ${text.slice(0, 300)}`);
      }
      const raw = await response.text();
      const chunks: Buffer[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const data = json?.choices?.[0]?.delta?.audio?.data;
        if (typeof data === 'string' && data.length > 0) {
          chunks.push(Buffer.from(data, 'base64'));
        }
      }
      if (chunks.length === 0) {
        throw new Error('OpenRouter TTS returned no audio payload');
      }
      return {
        audio: Buffer.concat(chunks),
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'openrouter',
        model,
        voice,
        // gpt-4o-audio-preview (the default audio model) emits pcm16
        // at 24 kHz mono — matches OpenAI's native TTS endpoint.
        pcm: format === 'pcm' ? { sampleRate: 24000, channels: 1, bitsPerSample: 16 } : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// MiniMax
// ---------------------------------------------------------------------------

function createMiniMaxProvider(
  apiKey: string,
  opts: { groupId?: string; defaultModel?: string; defaultVoice?: string },
): TtsProvider {
  const defaultModel = opts.defaultModel || 'speech-02-hd';
  const defaultVoice = opts.defaultVoice || 'male-qn-qingse';
  return {
    id: 'minimax',
    name: 'MiniMax',
    defaultModel,
    defaultVoice,
    supportedFormats: ['mp3', 'wav', 'pcm'],
    async speak(req) {
      const model = req.model || defaultModel;
      const voice = req.voice || defaultVoice;
      const format = req.format || 'mp3';
      const url = opts.groupId
        ? `https://api.minimax.chat/v1/t2a_v2?GroupId=${encodeURIComponent(opts.groupId)}`
        : `https://api.minimax.chat/v1/t2a_v2`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          text: req.text,
          voice_setting: { voice_id: voice, speed: 1.0, vol: 1.0, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format },
        }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`MiniMax TTS error ${response.status}: ${text.slice(0, 300)}`);
      }
      const body = (await response.json()) as {
        data?: { audio?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      const status = body.base_resp?.status_code ?? 0;
      if (status !== 0) {
        throw new Error(
          `MiniMax TTS: ${body.base_resp?.status_msg ?? `status ${status}`}`,
        );
      }
      const hex = body.data?.audio;
      if (!hex) throw new Error('MiniMax TTS returned no audio payload');
      const buf = Buffer.from(hex, 'hex');
      return {
        audio: buf,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'minimax',
        model,
        voice,
        // MiniMax we configure at 32 kHz, mono, 16-bit signed (audio_setting above).
        pcm: format === 'pcm' ? { sampleRate: 32000, channels: 1, bitsPerSample: 16 } : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Context + factory
// ---------------------------------------------------------------------------

export interface TextToSpeechContext {
  cwd: string;
  preferredProvider?:
    | 'openai'
    | 'elevenlabs'
    | 'google'
    | 'microsoft'
    | 'minimax'
    | 'openrouter';
  openaiApiKey?: string;
  openaiDefaultVoice?: string;
  openaiDefaultModel?: string;
  elevenLabsApiKey?: string;
  elevenLabsDefaultVoice?: string;
  elevenLabsDefaultModel?: string;
  geminiApiKey?: string;
  geminiDefaultVoice?: string;
  geminiDefaultModel?: string;
  microsoftApiKey?: string;
  microsoftRegion?: string;
  microsoftDefaultVoice?: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  minimaxDefaultVoice?: string;
  minimaxDefaultModel?: string;
  /** Lazy resolver for the OpenRouter key — called at tool execution time. */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  openrouterDefaultVoice?: string;
  openrouterDefaultModel?: string;
}

async function resolveProviders(ctx: TextToSpeechContext): Promise<TtsProvider[]> {
  const providers: TtsProvider[] = [];
  if (ctx.openaiApiKey) {
    providers.push(
      createOpenAiTtsProvider(ctx.openaiApiKey, {
        defaultModel: ctx.openaiDefaultModel,
        defaultVoice: ctx.openaiDefaultVoice,
      }),
    );
  }
  if (ctx.elevenLabsApiKey) {
    providers.push(
      createElevenLabsProvider(ctx.elevenLabsApiKey, {
        defaultModel: ctx.elevenLabsDefaultModel,
        defaultVoice: ctx.elevenLabsDefaultVoice,
      }),
    );
  }
  if (ctx.geminiApiKey) {
    providers.push(
      createGeminiTtsProvider(ctx.geminiApiKey, {
        defaultModel: ctx.geminiDefaultModel,
        defaultVoice: ctx.geminiDefaultVoice,
      }),
    );
  }
  if (ctx.microsoftApiKey && ctx.microsoftRegion) {
    providers.push(
      createMicrosoftTtsProvider(ctx.microsoftApiKey, {
        region: ctx.microsoftRegion,
        defaultVoice: ctx.microsoftDefaultVoice,
      }),
    );
  }
  if (ctx.minimaxApiKey) {
    providers.push(
      createMiniMaxProvider(ctx.minimaxApiKey, {
        groupId: ctx.minimaxGroupId,
        defaultModel: ctx.minimaxDefaultModel,
        defaultVoice: ctx.minimaxDefaultVoice,
      }),
    );
  }
  const openrouterApiKey = ctx.getOpenrouterApiKey
    ? await ctx.getOpenrouterApiKey()
    : undefined;
  if (openrouterApiKey) {
    providers.push(
      createOpenRouterTtsProvider(openrouterApiKey, {
        defaultModel: ctx.openrouterDefaultModel,
        defaultVoice: ctx.openrouterDefaultVoice,
      }),
    );
  }

  if (ctx.preferredProvider) {
    providers.sort((a, b) => {
      if (a.id === ctx.preferredProvider) return -1;
      if (b.id === ctx.preferredProvider) return 1;
      return 0;
    });
  }
  return providers;
}

function formatProviderList(providers: TtsProvider[]): string {
  if (providers.length === 0) {
    return 'No TTS providers configured. Set an API key for OpenAI, ElevenLabs, Google Gemini, Microsoft Azure, MiniMax, or OpenRouter.';
  }
  const lines = ['Available text-to-speech providers:'];
  for (const p of providers) {
    lines.push(
      `  ${p.id}: ${p.name} (model: ${p.defaultModel}, default voice: ${p.defaultVoice}, formats: ${p.supportedFormats.join(', ')})`,
    );
  }
  return lines.join('\n');
}

/**
 * Structured payload the chat drawer reads to render an audio player
 * under the tool-result bubble. Kept out of `content` because
 * `AgentToolResult.content` is typed as `(TextContent | ImageContent)[]`
 * in `pi-agent-core`; the model doesn't need the audio bytes anyway —
 * it only needs the text summary describing what was produced.
 */
export interface TtsAudioDetails {
  audio: {
    /** e.g. 'audio/mpeg', 'audio/wav'. */
    mimeType: string;
    /** Base64-encoded audio bytes. */
    data: string;
    /** File path relative to the workspace. */
    path: string;
    /** Human-friendly filename suggested for download. */
    filename: string;
    /** Synthesis provider id that produced the clip. */
    provider: string;
    /** The raw text that was spoken — shown as a caption. */
    transcript: string;
  };
}

export type TtsToolResult = AgentToolResult<TtsAudioDetails | undefined>;

function textResult(text: string): TtsToolResult {
  return { content: [{ type: 'text', text }], details: undefined };
}

function sanitizeFilenameHint(hint: string): string {
  const base = hint.replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.replace(/[^a-zA-Z0-9._/-]/g, '_').slice(0, 120) || `speech_${Date.now()}`;
}

function pickProvider(
  providers: TtsProvider[],
  requested?: string,
): TtsProvider {
  if (providers.length === 0) {
    throw new Error(
      'No TTS providers configured. Set OPENAI_API_KEY, ELEVENLABS_API_KEY, GEMINI_API_KEY, AZURE_SPEECH_KEY + AZURE_SPEECH_REGION, MINIMAX_API_KEY, or an OpenRouter API key.',
    );
  }
  if (!requested) return providers[0];
  const found = providers.find((p) => p.id === requested);
  if (!found) {
    throw new Error(
      `Provider "${requested}" is not configured. Available: ${providers.map((p) => p.id).join(', ')}.`,
    );
  }
  return found;
}

function truncateForSummary(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Convert outbound reply text into spoken audio using ElevenLabs, Google Gemini,',
  'Microsoft Azure, MiniMax, OpenAI, or OpenRouter. Writes the audio file to the',
  `workspace under "${AUDIO_SUBDIR}/" and returns its path so the user can play it.`,
  '',
  'Actions:',
  '  speak — synthesize audio. Params: text, provider?, voice?, model?, format?, filename?',
  '  list  — show which providers are configured and their defaults.',
  '',
  'Use this whenever the user asks to hear a reply spoken, wants an audio version',
  'of an explanation, or prefers voice output.',
].join('\n');

export function createTextToSpeechTool(ctx: TextToSpeechContext): AgentTool<TSchema> {
  return {
    name: 'text_to_speech',
    description: DESCRIPTION,
    label: 'Text to Speech',
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          description: '"speak" (default) or "list" to see configured providers',
        }),
      ),
      text: Type.Optional(
        Type.String({
          description: 'The text to convert to audio (required for action="speak")',
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description:
            'openai | elevenlabs | google | microsoft | minimax | openrouter. Defaults to the preferred provider.',
        }),
      ),
      voice: Type.Optional(
        Type.String({ description: 'Provider-specific voice name or id' }),
      ),
      model: Type.Optional(
        Type.String({ description: 'Provider-specific model override' }),
      ),
      format: Type.Optional(
        Type.String({
          description: 'Audio format: mp3 (default), wav, pcm, or ogg (provider dependent)',
        }),
      ),
      filename: Type.Optional(
        Type.String({ description: 'Output filename hint (extension is appended automatically)' }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const action = (params.action as string) || 'speak';

      const providers = await resolveProviders(ctx);

      if (action === 'list') {
        return textResult(formatProviderList(providers));
      }
      if (action !== 'speak') {
        throw new Error(`Unknown action "${action}". Use "speak" or "list".`);
      }

      const text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!text) throw new Error('text is required for action="speak"');
      if (text.length > MAX_TEXT_CHARS) {
        throw new Error(
          `text is ${text.length} chars; the tool caps input at ${MAX_TEXT_CHARS} chars to avoid runaway TTS bills.`,
        );
      }

      const provider = pickProvider(providers, params.provider as string | undefined);

      const requestedFormat = (params.format as string | undefined)?.toLowerCase();
      const format: AudioFormat | undefined =
        requestedFormat === 'mp3' ||
        requestedFormat === 'wav' ||
        requestedFormat === 'pcm' ||
        requestedFormat === 'ogg'
          ? (requestedFormat as AudioFormat)
          : undefined;
      if (format && !provider.supportedFormats.includes(format)) {
        throw new Error(
          `Provider "${provider.id}" does not support format "${format}". Supported: ${provider.supportedFormats.join(', ')}.`,
        );
      }

      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) throw new Error('Aborted');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SEC * 1000);

      let result: SpeakResult;
      try {
        result = await provider.speak({
          text,
          voice: params.voice as string | undefined,
          model: params.model as string | undefined,
          format,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const hint = sanitizeFilenameHint(
        (params.filename as string | undefined) || `speech_${Date.now()}`,
      );
      const hintHasDir = hint.includes('/') || hint.includes('\\');
      const baseDir = hintHasDir ? ctx.cwd : path.resolve(ctx.cwd, AUDIO_SUBDIR);
      const outputPath = path.resolve(baseDir, `${hint}.${result.extension}`);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, result.audio);

      const relPath = path.relative(ctx.cwd, outputPath);
      const summary = [
        `Spoke ${result.audio.length.toLocaleString()} bytes via ${result.provider} ` +
          `(model: ${result.model}, voice: ${result.voice}, format: ${result.extension}).`,
        `Saved to: ${relPath}`,
        `Preview text: "${truncateForSummary(text)}"`,
        'Audio attached below — the user can play it inline in the chat drawer.',
      ].join('\n');

      // Raw PCM has no container, so `<audio>` in the chat drawer can't
      // decode it (no sample rate / channels / bit-depth info). When the
      // result is PCM, wrap it in a WAV header for the UI payload only.
      // The file on disk stays as the originally-requested `.pcm` so
      // external consumers still get what they asked for.
      const uiAudio =
        result.pcm !== undefined
          ? {
              bytes: wrapPcmAsWav(result.audio, result.pcm),
              mimeType: 'audio/wav',
            }
          : { bytes: result.audio, mimeType: result.mimeType };

      const details: TtsAudioDetails = {
        audio: {
          mimeType: uiAudio.mimeType,
          data: uiAudio.bytes.toString('base64'),
          path: relPath,
          filename: path.basename(outputPath),
          provider: result.provider,
          transcript: text,
        },
      };

      return {
        content: [{ type: 'text', text: summary }],
        details,
      } satisfies TtsToolResult;
    },
  };
}
