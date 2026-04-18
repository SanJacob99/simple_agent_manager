import { defineTool } from '../../tool-module';
import { createImageGenerateTool, type ImageGenerateContext } from './image-generate';

/**
 * Image generation. Aggregates three providers — OpenAI, Gemini,
 * OpenRouter — and lets the user pick a preferred model. Returns null
 * when the runtime has no workspace directory (can't save the output).
 *
 * All three API keys are optional at construction time; the tool's
 * runtime decides which provider to use based on which keys resolved.
 */
export default defineTool<ImageGenerateContext & { enabled: boolean }>({
  name: 'image_generate',
  label: 'Image Generate',
  description: 'Generate an image from a prompt and save it to the workspace',
  group: 'media',
  icon: 'image-plus',
  classification: 'state-mutating',

  resolveContext: (config, runtime) => ({
    enabled: Boolean(runtime.cwd),
    cwd: runtime.cwd ?? '',
    openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
    geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    getOpenrouterApiKey: runtime.getOpenrouterApiKey,
    preferredModel: config.imageModel,
  }),

  create: (ctx) => {
    if (!ctx.enabled) return null;
    return createImageGenerateTool({
      cwd: ctx.cwd,
      openaiApiKey: ctx.openaiApiKey,
      geminiApiKey: ctx.geminiApiKey,
      getOpenrouterApiKey: ctx.getOpenrouterApiKey,
      preferredModel: ctx.preferredModel,
    });
  },
});
