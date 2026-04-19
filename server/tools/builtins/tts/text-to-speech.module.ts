import { defineTool } from '../../tool-module';
import { createTextToSpeechTool, type TextToSpeechContext } from './text-to-speech';

/**
 * Text-to-speech. Aggregates six providers (OpenAI, ElevenLabs, Google
 * Gemini, Microsoft Azure, MiniMax, OpenRouter) and lets the user pick
 * a preferred one. Returns null when no workspace directory is
 * configured — the tool needs somewhere to write the synthesized audio
 * file.
 *
 * All API keys are optional at construction time; the tool's runtime
 * decides which provider to use based on which keys resolved. The
 * OpenRouter key resolves lazily through `runtime.getOpenrouterApiKey`
 * because it lives in the ApiKeyStore, not on the AgentConfig.
 */
export default defineTool<TextToSpeechContext & { enabled: boolean }>({
  name: 'text_to_speech',
  label: 'Text to Speech',
  description: 'Convert text to speech and save the audio file to the workspace',
  group: 'media',
  icon: 'volume-2',
  classification: 'state-mutating',

  resolveContext: (config, runtime) => ({
    enabled: Boolean(runtime.cwd),
    cwd: runtime.cwd ?? '',
    preferredProvider: config.ttsPreferredProvider,
    openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
    openaiDefaultVoice: config.openaiTtsVoice,
    openaiDefaultModel: config.openaiTtsModel,
    elevenLabsApiKey: config.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY,
    elevenLabsDefaultVoice: config.elevenLabsDefaultVoice,
    elevenLabsDefaultModel: config.elevenLabsDefaultModel,
    geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    geminiDefaultVoice: config.geminiTtsVoice,
    geminiDefaultModel: config.geminiTtsModel,
    microsoftApiKey: config.microsoftTtsApiKey || process.env.AZURE_SPEECH_KEY,
    microsoftRegion: config.microsoftTtsRegion || process.env.AZURE_SPEECH_REGION,
    microsoftDefaultVoice: config.microsoftTtsVoice,
    minimaxApiKey: config.minimaxApiKey || process.env.MINIMAX_API_KEY,
    minimaxGroupId: config.minimaxGroupId || process.env.MINIMAX_GROUP_ID,
    minimaxDefaultVoice: config.minimaxDefaultVoice,
    minimaxDefaultModel: config.minimaxDefaultModel,
    getOpenrouterApiKey: runtime.getOpenrouterApiKey,
    openrouterDefaultVoice: config.openrouterTtsVoice,
    openrouterDefaultModel: config.openrouterTtsModel,
  }),

  create: (ctx) => {
    if (!ctx.enabled) return null;
    return createTextToSpeechTool({
      cwd: ctx.cwd,
      preferredProvider: ctx.preferredProvider,
      openaiApiKey: ctx.openaiApiKey,
      openaiDefaultVoice: ctx.openaiDefaultVoice,
      openaiDefaultModel: ctx.openaiDefaultModel,
      elevenLabsApiKey: ctx.elevenLabsApiKey,
      elevenLabsDefaultVoice: ctx.elevenLabsDefaultVoice,
      elevenLabsDefaultModel: ctx.elevenLabsDefaultModel,
      geminiApiKey: ctx.geminiApiKey,
      geminiDefaultVoice: ctx.geminiDefaultVoice,
      geminiDefaultModel: ctx.geminiDefaultModel,
      microsoftApiKey: ctx.microsoftApiKey,
      microsoftRegion: ctx.microsoftRegion,
      microsoftDefaultVoice: ctx.microsoftDefaultVoice,
      minimaxApiKey: ctx.minimaxApiKey,
      minimaxGroupId: ctx.minimaxGroupId,
      minimaxDefaultVoice: ctx.minimaxDefaultVoice,
      minimaxDefaultModel: ctx.minimaxDefaultModel,
      getOpenrouterApiKey: ctx.getOpenrouterApiKey,
      openrouterDefaultVoice: ctx.openrouterDefaultVoice,
      openrouterDefaultModel: ctx.openrouterDefaultModel,
    });
  },
});
