import { defineTool } from '../../tool-module';
import { createMusicGenerateTool, type MusicGenerateContext } from './music-generate';

/**
 * Music generation. Aggregates Google Lyria and MiniMax Music. Reuses
 * the Gemini API key (Google Lyria) and the MiniMax API key from TTS,
 * so configuring TTS is enough to also light up music generation.
 *
 * Returns null when no workspace directory is configured — the tool
 * needs somewhere to write the synthesized audio file.
 */
export default defineTool<MusicGenerateContext & { enabled: boolean }>({
  name: 'music_generate',
  label: 'Music Generate',
  description: 'Generate music or ambient audio from a prompt and save it to the workspace',
  group: 'media',
  icon: 'music',
  classification: 'state-mutating',

  resolveContext: (config, runtime) => ({
    enabled: Boolean(runtime.cwd),
    cwd: runtime.cwd ?? '',
    preferredProvider: config.musicPreferredProvider,
    geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    geminiDefaultModel: config.geminiMusicModel,
    minimaxApiKey: config.minimaxApiKey || process.env.MINIMAX_API_KEY,
    minimaxGroupId: config.minimaxGroupId || process.env.MINIMAX_GROUP_ID,
    minimaxDefaultModel: config.minimaxMusicModel,
  }),

  create: (ctx) => {
    if (!ctx.enabled) return null;
    return createMusicGenerateTool({
      cwd: ctx.cwd,
      preferredProvider: ctx.preferredProvider,
      geminiApiKey: ctx.geminiApiKey,
      geminiDefaultModel: ctx.geminiDefaultModel,
      minimaxApiKey: ctx.minimaxApiKey,
      minimaxGroupId: ctx.minimaxGroupId,
      minimaxDefaultModel: ctx.minimaxDefaultModel,
    });
  },
});
