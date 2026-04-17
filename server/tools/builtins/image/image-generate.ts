import fs from 'fs/promises';
import path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const DEFAULT_SIZE = '1024x1024';
const DEFAULT_TIMEOUT_SEC = 90;
const IMAGES_SUBDIR = 'images';

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

interface GenerateRequest {
  prompt: string;
  size?: string;
  count?: number;
  referenceImages?: Buffer[];
  signal?: AbortSignal;
}

interface GenerateResult {
  images: Array<{ data: string; mimeType: string; revisedPrompt?: string }>;
  model: string;
  provider: string;
}

interface ImageProvider {
  id: string;
  name: string;
  defaultModel: string;
  supportsEdit: boolean;
  sizes: string[];
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------
// OpenAI provider (DALL-E / gpt-image-1)
// ---------------------------------------------------------------------------

function createOpenAIProvider(apiKey: string, modelOverride?: string): ImageProvider {
  const model = modelOverride || 'gpt-image-1';
  return {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: model,
    supportsEdit: true,
    sizes: ['1024x1024', '1024x1536', '1536x1024', '1024x1792', '1792x1024'],
    async generate(req) {
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        n: req.count ?? 1,
        size: req.size || DEFAULT_SIZE,
        response_format: 'b64_json',
      };

      const response = await fetch('https://api.openai.com/v1/images/generations', {
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
        throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json() as {
        data?: Array<{ b64_json?: string; revised_prompt?: string }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`OpenAI: ${data.error.message}`);

      const images = (data.data ?? [])
        .filter((d) => d.b64_json)
        .map((d) => ({
          data: d.b64_json!,
          mimeType: 'image/png',
          revisedPrompt: d.revised_prompt,
        }));

      if (images.length === 0) throw new Error('No image data returned from OpenAI');
      return { images, model, provider: 'openai' };
    },
  };
}

// ---------------------------------------------------------------------------
// Google Gemini provider
// ---------------------------------------------------------------------------

function createGeminiProvider(apiKey: string, modelOverride?: string): ImageProvider {
  const model = modelOverride || 'gemini-2.0-flash-exp';
  return {
    id: 'google',
    name: 'Google',
    defaultModel: model,
    supportsEdit: true,
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    async generate(req) {
      const contents = [{ parts: [{ text: req.prompt }], role: 'user' }];

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
          signal: req.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Google API error ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> };
        }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`Google: ${data.error.message}`);

      const images: Array<{ data: string; mimeType: string }> = [];
      for (const candidate of data.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            images.push({
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'image/png',
            });
          }
        }
      }

      if (images.length === 0) throw new Error('No image data returned from Google');
      return { images, model, provider: 'google' };
    },
  };
}

// ---------------------------------------------------------------------------
// OpenRouter provider (uses chat completions with multimodal output)
// ---------------------------------------------------------------------------

// Parse a data URL or base64 image payload into { mimeType, base64 }
function parseImagePayload(raw: string): { mimeType: string; data: string } | null {
  if (!raw) return null;
  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return { mimeType: dataUrlMatch[1], data: dataUrlMatch[2] };
  }
  // Already base64 (no data URL wrapper) — assume PNG
  if (/^[A-Za-z0-9+/]+=*$/.test(raw.slice(0, 100))) {
    return { mimeType: 'image/png', data: raw };
  }
  return null;
}

function createOpenRouterProvider(apiKey: string, modelOverride?: string): ImageProvider {
  const model = modelOverride || 'google/gemini-2.5-flash-image-preview';
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: model,
    supportsEdit: false,
    sizes: ['1024x1024'],
    async generate(req) {
      // OpenRouter exposes image-generating models via standard chat completions.
      // Multimodal output is requested via `modalities: ["image", "text"]`.
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: req.prompt }],
          modalities: ['image', 'text'],
        }),
        signal: req.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            images?: Array<{ type?: string; image_url?: { url?: string } }>;
          };
        }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);

      const message = data.choices?.[0]?.message;
      const images: Array<{ data: string; mimeType: string; revisedPrompt?: string }> = [];

      // Image blocks live in message.images as { type: "image_url", image_url: { url: "data:..." } }
      for (const img of message?.images ?? []) {
        const url = img.image_url?.url;
        if (!url) continue;
        const parsed = parseImagePayload(url);
        if (parsed) {
          images.push({
            data: parsed.data,
            mimeType: parsed.mimeType,
            revisedPrompt: message?.content,
          });
        }
      }

      if (images.length === 0) {
        throw new Error(
          `No image data returned from OpenRouter. Response content: ${(message?.content ?? '').slice(0, 200)}`,
        );
      }
      return { images, model, provider: 'openrouter' };
    },
  };
}

// ---------------------------------------------------------------------------
// Context & factory
// ---------------------------------------------------------------------------

export interface ImageGenerateContext {
  cwd: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  /** Lazy resolver for the OpenRouter key — called at tool execution time */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  preferredModel?: string;
}

async function resolveProviders(ctx: ImageGenerateContext): Promise<ImageProvider[]> {
  const providers: ImageProvider[] = [];

  // Parse preferred model for provider hint
  const preferredProvider = ctx.preferredModel?.split('/')[0];
  const preferredModelName = ctx.preferredModel?.includes('/')
    ? ctx.preferredModel.split('/').slice(1).join('/')
    : undefined;

  if (ctx.openaiApiKey) {
    providers.push(createOpenAIProvider(
      ctx.openaiApiKey,
      preferredProvider === 'openai' ? preferredModelName : undefined,
    ));
  }
  if (ctx.geminiApiKey) {
    providers.push(createGeminiProvider(
      ctx.geminiApiKey,
      preferredProvider === 'google' ? preferredModelName : undefined,
    ));
  }
  const openrouterApiKey = ctx.getOpenrouterApiKey
    ? await ctx.getOpenrouterApiKey()
    : undefined;
  if (openrouterApiKey) {
    providers.push(createOpenRouterProvider(
      openrouterApiKey,
      ctx.preferredModel || undefined,
    ));
  }

  // Reorder if preferred provider is specified
  if (preferredProvider) {
    providers.sort((a, b) => {
      if (a.id === preferredProvider) return -1;
      if (b.id === preferredProvider) return 1;
      return 0;
    });
  }

  return providers;
}

function formatProviderList(providers: ImageProvider[]): string {
  if (providers.length === 0) {
    return 'No image generation providers configured. Set OPENAI_API_KEY or GEMINI_API_KEY.';
  }
  const lines = ['Available image generation providers:'];
  for (const p of providers) {
    lines.push(`  ${p.id}: ${p.name} (model: ${p.defaultModel}, edit: ${p.supportsEdit ? 'yes' : 'no'})`);
    lines.push(`    sizes: ${p.sizes.join(', ')}`);
  }
  return lines.join('\n');
}

export function createImageGenerateTool(ctx: ImageGenerateContext): AgentTool<TSchema> {
  // Provider names are resolved lazily at call time (OpenRouter key is async)
  const staticProviderNames: string[] = [];
  if (ctx.openaiApiKey) staticProviderNames.push('OpenAI');
  if (ctx.geminiApiKey) staticProviderNames.push('Google');
  if (ctx.getOpenrouterApiKey) staticProviderNames.push('OpenRouter');
  const providerNames = staticProviderNames.join(', ') || 'configured at runtime';

  return {
    name: 'image_generate',
    description:
      `Generate images from text prompts. Providers: ${providerNames}. ` +
      `Use action "list" to see available providers and models. ` +
      'Be descriptive in your prompt for best results. ' +
      `Generated images are saved to the workspace under the "${IMAGES_SUBDIR}/" subfolder.`,
    label: 'Image Generate',
    parameters: Type.Object({
      prompt: Type.Optional(
        Type.String({ description: 'Image generation prompt (required for action "generate")' }),
      ),
      action: Type.Optional(
        Type.String({ description: '"generate" (default) or "list" to inspect providers' }),
      ),
      model: Type.Optional(
        Type.String({ description: 'Provider/model override, e.g. openai/gpt-image-1' }),
      ),
      size: Type.Optional(
        Type.String({ description: 'Size: 1024x1024, 1024x1536, 1536x1024, 1024x1792, 1792x1024' }),
      ),
      count: Type.Optional(
        Type.Number({ description: 'Number of images (1-4, default: 1)' }),
      ),
      filename: Type.Optional(
        Type.String({ description: 'Output filename hint' }),
      ),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const action = (params.action as string) || 'generate';

      // Resolve providers lazily (fetches OpenRouter key from ApiKeyStore)
      const providers = await resolveProviders(ctx);

      if (action === 'list') {
        return {
          content: [{ type: 'text', text: formatProviderList(providers) }],
          details: undefined,
        };
      }

      const prompt = params.prompt as string;
      if (!prompt?.trim()) throw new Error('No prompt provided for image generation');

      if (providers.length === 0) {
        throw new Error(
          'No image generation providers available. Set OPENAI_API_KEY, GEMINI_API_KEY, or an OpenRouter API key.',
        );
      }

      // Resolve provider from model override or use primary
      let provider = providers[0];
      const modelOverride = params.model as string | undefined;
      if (modelOverride?.includes('/')) {
        const providerId = modelOverride.split('/')[0];
        const found = providers.find((p) => p.id === providerId);
        if (found) provider = found;
      }

      const count = Math.min(Math.max(1, params.count ?? 1), 4);
      const size = params.size || DEFAULT_SIZE;
      const filenameHint = params.filename || `image_${Date.now()}`;

      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) throw new Error('Aborted');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SEC * 1000);

      try {
        const result = await provider.generate({
          prompt,
          size,
          count,
          signal: controller.signal,
        });

        // Save images to workspace
        const savedPaths: string[] = [];
        const contentBlocks: Array<{ type: string; text?: string; mimeType?: string; data?: string }> = [];

        // Generated images go into a dedicated subfolder of the workspace unless
        // the filename hint already specifies a path (respect explicit placement).
        const hintHasDir = filenameHint.includes('/') || filenameHint.includes('\\');
        const baseDir = hintHasDir ? ctx.cwd : path.resolve(ctx.cwd, IMAGES_SUBDIR);

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i];
          const ext = img.mimeType === 'image/jpeg' ? '.jpg' : '.png';
          const filename = result.images.length === 1
            ? `${filenameHint}${ext}`
            : `${filenameHint}_${i + 1}${ext}`;

          const outputPath = path.resolve(baseDir, filename);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, Buffer.from(img.data, 'base64'));
          savedPaths.push(path.relative(ctx.cwd, outputPath));

          contentBlocks.push({ type: 'image', mimeType: img.mimeType, data: img.data });
        }

        const summary = [
          `Generated ${result.images.length} image${result.images.length !== 1 ? 's' : ''} ` +
            `with ${result.provider}/${result.model} (${size}).`,
          `Saved to: ${savedPaths.join(', ')}`,
        ];

        const revisedPrompt = result.images[0]?.revisedPrompt;
        if (revisedPrompt) {
          summary.push(`Revised prompt: ${revisedPrompt}`);
        }

        contentBlocks.push({ type: 'text', text: summary.join('\n') });

        return { content: contentBlocks as any, details: undefined };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
