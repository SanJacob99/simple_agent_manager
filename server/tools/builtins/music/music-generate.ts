import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const MUSIC_SUBDIR = 'music';
const DEFAULT_TIMEOUT_SEC = 180;
const DEFAULT_DURATION_SEC = 30;
const MAX_DURATION_SEC = 240;
const MAX_PROMPT_CHARS = 2000;
const MAX_LYRICS_CHARS = 6000;

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

type AudioFormat = 'mp3' | 'wav';

interface GenerateRequest {
  prompt: string;
  lyrics?: string;
  model?: string;
  format?: AudioFormat;
  durationSec?: number;
  signal?: AbortSignal;
}

interface GenerateResult {
  audio: Buffer;
  mimeType: string;
  extension: string;
  provider: string;
  model: string;
  durationSec?: number;
}

interface MusicProvider {
  id: string;
  name: string;
  defaultModel: string;
  supportedFormats: AudioFormat[];
  supportsLyrics: boolean;
  maxDurationSec: number;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

function extFor(format: AudioFormat): string {
  return format;
}

function mimeFor(format: AudioFormat): string {
  return format === 'wav' ? 'audio/wav' : 'audio/mpeg';
}

// ---------------------------------------------------------------------------
// Google Lyria (Generative Language / Vertex-style predict)
// ---------------------------------------------------------------------------

function createGoogleMusicProvider(
  apiKey: string,
  opts: { defaultModel?: string },
): MusicProvider {
  const defaultModel = opts.defaultModel || 'lyria-002';
  return {
    id: 'google',
    name: 'Google Lyria',
    defaultModel,
    supportedFormats: ['wav', 'mp3'],
    supportsLyrics: false,
    maxDurationSec: 30,
    async generate(req) {
      const model = req.model || defaultModel;
      const format = req.format || 'wav';
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${encodeURIComponent(model)}:predict?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: req.prompt }],
          parameters: {
            sampleCount: 1,
            durationSeconds: req.durationSec ?? DEFAULT_DURATION_SEC,
          },
        }),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Google Lyria error ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = (await response.json()) as {
        predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`Google Lyria: ${data.error.message}`);
      const payload = data.predictions?.find((p) => p.bytesBase64Encoded);
      if (!payload?.bytesBase64Encoded) {
        throw new Error('Google Lyria returned no audio payload');
      }
      const audio = Buffer.from(payload.bytesBase64Encoded, 'base64');
      return {
        audio,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'google',
        model,
        durationSec: req.durationSec,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// MiniMax Music
// ---------------------------------------------------------------------------

function createMiniMaxMusicProvider(
  apiKey: string,
  opts: { groupId?: string; defaultModel?: string },
): MusicProvider {
  const defaultModel = opts.defaultModel || 'music-01';
  return {
    id: 'minimax',
    name: 'MiniMax Music',
    defaultModel,
    supportedFormats: ['mp3', 'wav'],
    supportsLyrics: true,
    maxDurationSec: 240,
    async generate(req) {
      const model = req.model || defaultModel;
      const format = req.format || 'mp3';
      const url = opts.groupId
        ? `https://api.minimax.chat/v1/music_generation?GroupId=${encodeURIComponent(opts.groupId)}`
        : `https://api.minimax.chat/v1/music_generation`;
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        audio_setting: {
          sample_rate: 44100,
          bitrate: 256000,
          format,
        },
      };
      if (req.lyrics && req.lyrics.trim()) {
        body.lyrics = req.lyrics;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`MiniMax Music error ${response.status}: ${text.slice(0, 300)}`);
      }
      const payload = (await response.json()) as {
        data?: { audio?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      };
      const status = payload.base_resp?.status_code ?? 0;
      if (status !== 0) {
        throw new Error(
          `MiniMax Music: ${payload.base_resp?.status_msg ?? `status ${status}`}`,
        );
      }
      const hex = payload.data?.audio;
      if (!hex) throw new Error('MiniMax Music returned no audio payload');
      const audio = Buffer.from(hex, 'hex');
      return {
        audio,
        mimeType: mimeFor(format),
        extension: extFor(format),
        provider: 'minimax',
        model,
        durationSec: req.durationSec,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Context + factory
// ---------------------------------------------------------------------------

export interface MusicGenerateContext {
  cwd: string;
  preferredProvider?: 'google' | 'minimax';
  geminiApiKey?: string;
  geminiDefaultModel?: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  minimaxDefaultModel?: string;
}

function resolveProviders(ctx: MusicGenerateContext): MusicProvider[] {
  const providers: MusicProvider[] = [];
  if (ctx.geminiApiKey) {
    providers.push(
      createGoogleMusicProvider(ctx.geminiApiKey, {
        defaultModel: ctx.geminiDefaultModel,
      }),
    );
  }
  if (ctx.minimaxApiKey) {
    providers.push(
      createMiniMaxMusicProvider(ctx.minimaxApiKey, {
        groupId: ctx.minimaxGroupId,
        defaultModel: ctx.minimaxDefaultModel,
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

function formatProviderList(providers: MusicProvider[]): string {
  if (providers.length === 0) {
    return 'No music generation providers configured. Set GEMINI_API_KEY for Google Lyria or MINIMAX_API_KEY for MiniMax Music.';
  }
  const lines = ['Available music generation providers:'];
  for (const p of providers) {
    lines.push(
      `  ${p.id}: ${p.name} (model: ${p.defaultModel}, formats: ${p.supportedFormats.join(', ')}, ` +
        `max duration: ${p.maxDurationSec}s, lyrics: ${p.supportsLyrics ? 'yes' : 'no'})`,
    );
  }
  return lines.join('\n');
}

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function sanitizeFilenameHint(hint: string): string {
  const base = hint.replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.replace(/[^a-zA-Z0-9._/-]/g, '_').slice(0, 120) || `music_${Date.now()}`;
}

function pickProvider(providers: MusicProvider[], requested?: string): MusicProvider {
  if (providers.length === 0) {
    throw new Error(
      'No music generation providers configured. Set GEMINI_API_KEY or MINIMAX_API_KEY.',
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
  'Generate music or ambient audio from a text prompt using Google Lyria or',
  `MiniMax Music. Writes the audio file to the workspace under "${MUSIC_SUBDIR}/"`,
  'and returns its path so the user can play it.',
  '',
  'Actions:',
  '  generate — create a music clip. Params: prompt, lyrics?, provider?, model?, format?, duration?, filename?',
  '  list     — show which providers are configured and their defaults.',
  '',
  'Use this when the user asks for a song, jingle, soundtrack, instrumental',
  'background, or any generated audio that is not spoken text. For spoken text',
  'use text_to_speech instead.',
].join('\n');

export function createMusicGenerateTool(
  ctx: MusicGenerateContext,
): AgentTool<TSchema> {
  return {
    name: 'music_generate',
    description: DESCRIPTION,
    label: 'Music Generate',
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({
          description: '"generate" (default) or "list" to see configured providers',
        }),
      ),
      prompt: Type.Optional(
        Type.String({
          description:
            'Text description of the music to generate (required for action="generate"). ' +
            'Describe genre, mood, instruments, tempo, structure.',
        }),
      ),
      lyrics: Type.Optional(
        Type.String({
          description:
            'Optional lyrics for vocal tracks. Only providers that support lyrics (e.g. MiniMax) will use them.',
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description: 'google | minimax. Defaults to the preferred provider.',
        }),
      ),
      model: Type.Optional(
        Type.String({ description: 'Provider-specific model override' }),
      ),
      format: Type.Optional(
        Type.String({
          description: 'Audio format: mp3 (default for MiniMax) or wav (default for Google).',
        }),
      ),
      duration: Type.Optional(
        Type.Number({
          description:
            `Desired duration in seconds (default ${DEFAULT_DURATION_SEC}). Capped per provider.`,
        }),
      ),
      filename: Type.Optional(
        Type.String({
          description: 'Output filename hint (extension is appended automatically).',
        }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const action = (params.action as string) || 'generate';
      const providers = resolveProviders(ctx);

      if (action === 'list') {
        return textResult(formatProviderList(providers));
      }
      if (action !== 'generate') {
        throw new Error(`Unknown action "${action}". Use "generate" or "list".`);
      }

      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
      if (!prompt) throw new Error('prompt is required for action="generate"');
      if (prompt.length > MAX_PROMPT_CHARS) {
        throw new Error(
          `prompt is ${prompt.length} chars; the tool caps prompts at ${MAX_PROMPT_CHARS}.`,
        );
      }
      const lyrics =
        typeof params.lyrics === 'string' && params.lyrics.trim()
          ? params.lyrics
          : undefined;
      if (lyrics && lyrics.length > MAX_LYRICS_CHARS) {
        throw new Error(
          `lyrics are ${lyrics.length} chars; the tool caps lyrics at ${MAX_LYRICS_CHARS}.`,
        );
      }

      const provider = pickProvider(providers, params.provider as string | undefined);

      if (lyrics && !provider.supportsLyrics) {
        throw new Error(
          `Provider "${provider.id}" does not support lyrics. Omit "lyrics" or pick another provider.`,
        );
      }

      const requestedFormat = (params.format as string | undefined)?.toLowerCase();
      const format: AudioFormat | undefined =
        requestedFormat === 'mp3' || requestedFormat === 'wav'
          ? (requestedFormat as AudioFormat)
          : undefined;
      if (format && !provider.supportedFormats.includes(format)) {
        throw new Error(
          `Provider "${provider.id}" does not support format "${format}". Supported: ${provider.supportedFormats.join(', ')}.`,
        );
      }

      let durationSec: number | undefined;
      if (typeof params.duration === 'number' && Number.isFinite(params.duration)) {
        const clampMax = Math.min(provider.maxDurationSec, MAX_DURATION_SEC);
        durationSec = Math.max(1, Math.min(params.duration, clampMax));
      }

      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) throw new Error('Aborted');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SEC * 1000);

      let result: GenerateResult;
      try {
        result = await provider.generate({
          prompt,
          lyrics,
          model: params.model as string | undefined,
          format,
          durationSec,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const hint = sanitizeFilenameHint(
        (params.filename as string | undefined) || `music_${Date.now()}`,
      );
      const hintHasDir = hint.includes('/') || hint.includes('\\');
      const baseDir = hintHasDir ? ctx.cwd : path.resolve(ctx.cwd, MUSIC_SUBDIR);
      const outputPath = path.resolve(baseDir, `${hint}.${result.extension}`);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, result.audio);

      const relPath = path.relative(ctx.cwd, outputPath);
      const summary = [
        `Generated ${result.audio.length.toLocaleString()} bytes of audio via ` +
          `${result.provider} (model: ${result.model}, format: ${result.extension}` +
          `${result.durationSec ? `, ~${result.durationSec}s` : ''}).`,
        `Saved to: ${relPath}`,
        `Prompt: "${truncateForSummary(prompt)}"`,
      ];
      if (lyrics) summary.push(`Lyrics: "${truncateForSummary(lyrics)}"`);

      return textResult(summary.join('\n'));
    },
  };
}
