# Tool Node

> Configures which tools an agent can use through profiles, groups, direct enables, skills, and plugins.

<!-- source: src/types/nodes.ts#ToolsNodeData -->
<!-- last-verified: 2026-05-06 -->

## Overview

The Tool Node defines the capabilities available to an agent at runtime. Rather than storing a flat tool list, it uses layered resolution:

- a profile contributes baseline groups
- groups add bundles of tools
- individual tools opt specific names in
- tool plugins add extra tools and skills

Skills stored on the Tool Node are merged into system prompt content during graph resolution. The resolved tool names are then instantiated by `createAgentTools()` in `server/runtime/tool-factory.ts`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Tools"` | Display label on the canvas |
| `profile` | `ToolProfile` | `"full"` | Preset tool collection: `full`, `coding`, `messaging`, `minimal`, `custom` |
| `enabledTools` | `string[]` | `["ask_user", "confirm_action"]` | Individual tool names to enable beyond the profile. HITL tools are on by default and locked unless "Dangerous Fully Auto" mode is enabled in Settings |
| `enabledGroups` | `ToolGroup[]` | `[]` | Additional tool groups to enable beyond the profile |
| `skills` | `SkillDefinition[]` | `[]` | Skill definitions that are folded into prompt assembly |
| `plugins` | `PluginDefinition[]` | `[]` | Plugin bundles that contribute tools, skills, and optional hooks |
| `subAgentSpawning` | `boolean` | `false` | Whether the agent may spawn sub-agents |
| `maxSubAgents` | `number` | `3` | Maximum concurrent sub-agents |
| `toolSettings.canva.portRangeStart` | `number` | `5173` | Lower bound of the port range canva auto-picks from |
| `toolSettings.canva.portRangeEnd` | `number` | `5273` | Upper bound of the port range canva auto-picks from |
| `toolSettings.canva.skill` | `string` | `""` | Optional inline markdown override for the canva skill. When non-empty, it replaces the bundled `canva/SKILL.md` reference with the user-authored text injected directly into the system prompt |
| `toolSettings.textToSpeech.preferredProvider` | `string` | `""` | Default TTS provider: `openai`, `elevenlabs`, `google`, `microsoft`, `minimax`, or `openrouter` |
| `toolSettings.textToSpeech.elevenLabsApiKey` | `string` | `""` | ElevenLabs API key. Empty reads `ELEVENLABS_API_KEY` from env |
| `toolSettings.textToSpeech.elevenLabsDefaultVoice` | `string` | `""` | ElevenLabs voice id (e.g. `21m00Tcm4TlvDq8ikWAM`) |
| `toolSettings.textToSpeech.openaiVoice` | `string` | `""` | OpenAI TTS voice (e.g. `alloy`). Uses the image-tool OpenAI API key |
| `toolSettings.textToSpeech.openaiModel` | `string` | `""` | OpenAI TTS model (e.g. `gpt-4o-mini-tts`) |
| `toolSettings.textToSpeech.geminiVoice` | `string` | `""` | Google Gemini TTS voice. Uses the image-tool Gemini API key |
| `toolSettings.textToSpeech.microsoftApiKey` | `string` | `""` | Azure Speech key. Empty reads `AZURE_SPEECH_KEY` from env |
| `toolSettings.textToSpeech.microsoftRegion` | `string` | `""` | Azure region, e.g. `eastus` |
| `toolSettings.textToSpeech.minimaxApiKey` | `string` | `""` | MiniMax API key. Empty reads `MINIMAX_API_KEY` from env |
| `toolSettings.textToSpeech.minimaxGroupId` | `string` | `""` | MiniMax group id. Empty reads `MINIMAX_GROUP_ID` from env |
| `toolSettings.textToSpeech.openrouterVoice` | `string` | `""` | Voice for the OpenRouter audio model (e.g. `alloy`). Uses the OpenRouter key from the global API key store |
| `toolSettings.textToSpeech.openrouterModel` | `string` | `""` | OpenRouter audio-capable model id, e.g. `openai/gpt-4o-audio-preview` |
| `toolSettings.textToSpeech.skill` | `string` | `""` | Optional inline markdown override for the text_to_speech skill. When non-empty, it replaces the bundled `text-to-speech/SKILL.md` reference with the user-authored text injected directly into the system prompt |
| `toolSettings.musicGenerate.preferredProvider` | `string` | `""` | Default music provider: `google` or `minimax` |
| `toolSettings.musicGenerate.geminiModel` | `string` | `""` | Google Lyria model override (reuses the image-tool Gemini API key) |
| `toolSettings.musicGenerate.minimaxModel` | `string` | `""` | MiniMax music model override, e.g. `music-01` (reuses the text_to_speech MiniMax key and group id) |
| `toolSettings.musicGenerate.skill` | `string` | `""` | Optional inline markdown override for the music_generate skill. When non-empty, it replaces the bundled `music-generate/SKILL.md` reference with the user-authored text injected directly into the system prompt |

> **Deprecated.** `subAgentSpawning` and `maxSubAgents` are no longer used by the runtime. Sub-agent capability is now declared via the [Sub-Agent Node](sub-agent-node.md). Existing graphs continue to load, but these fields have no effect.

## Runtime Behavior

Tool name resolution happens in `shared/resolve-tool-names.ts` in this order:

1. Expand the selected profile into groups
2. Expand the resulting groups into tool names
3. Add `enabledGroups`
4. Add `enabledTools`
5. Add tools contributed by enabled tool plugins
6. Deduplicate the final list

`server/runtime/tool-factory.ts` then instantiates concrete `AgentTool` objects:

- memory tools are skipped there because `MemoryEngine` provides them separately
- session tools are skipped because they are injected later by the run coordinator
- `calculator` and the built-in `web_fetch` have real implementations
- `canva` writes HTML/CSS/JS into `<cwd>/.canva/<name>/` and serves each canvas from its own static HTTP server on a port auto-picked from the configured range
- `text_to_speech` synthesizes audio via ElevenLabs, Google Gemini, Microsoft Azure, MiniMax, OpenAI, or OpenRouter (audio-capable chat model, e.g. `openai/gpt-4o-audio-preview`) and writes the resulting file into `<cwd>/audio/`
- `music_generate` generates music or ambient audio via Google Lyria or MiniMax Music and writes the resulting file into `<cwd>/music/`. The Gemini API key is reused from the image settings, and the MiniMax API key and group id are reused from text_to_speech
- `code_interpreter` is treated as a legacy alias and canonicalized to `code_execution` during tool-name resolution, so older saved configs still enable the same runtime tool
- if the resolved tool list already includes `web_search` or `web_fetch` and the active provider plugin supplies replacements, `createAgentTools()` swaps in the provider-backed implementation instead of auto-adding new tools

Skill handling happens in `resolveAgentConfig()` and feeds the `## Skills` section of the system prompt via `buildSystemPrompt()`. There are three buckets:

1. **Available** — a compact list of bundled SKILL.md files whose triggering tools are enabled. Each line is `- <id> (<location>) — <description> → <path>`, where `<path>` contains the `{SAM_BUNDLED_ROOT}` placeholder the server substitutes at runtime. Bundled content lives on disk at `server/skills/bundled/<id>/SKILL.md`; the manifest that decides which ones are eligible is in `shared/default-tool-skills.ts`. The prompt tells the agent to `read_file` a SKILL.md only when its topic becomes relevant, so guidance stays out-of-band by default.
2. **Tags** — bullet list of declarative skill names contributed by connected Skill Nodes.
3. **Inline blocks** — full markdown content from `SkillDefinition` entries on the Tools Node and from any per-tool `toolSettings.<tool>.skill` overrides the user has typed. An inline override for a given tool suppresses that tool's bundled reference, so the user's text becomes the sole source of guidance for it.

Bundled references are computed from the resolved tool list (not from the stored `tools.skills` array), so `AgentConfig.tools.skills` only round-trips custom `SkillDefinition` entries and overrides.

## Authoring a New Tool

To add a new tool — either into the SAM codebase or into your own install — write one file: a `ToolModule` that declares its name, group, classification, config, and a `create()` factory. The filesystem scan in [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts) auto-loads every `*.module.ts` under `server/tools/builtins/` at startup; no central registry edit is required.

Quick shape:

```ts
// server/tools/builtins/weather/weather.module.ts
import { defineTool } from '../../tool-module';
import { createWeatherTool } from './weather';

export default defineTool({
  name: 'weather',
  group: 'web',
  label: 'Weather',
  description: 'Fetch current weather for a city',
  classification: 'read-only',
  resolveContext: (config) => ({ apiKey: config.weatherApiKey || process.env.WEATHER_API_KEY }),
  create: (ctx) => (ctx.apiKey ? createWeatherTool({ apiKey: ctx.apiKey }) : null),
});
```

See [adding-a-tool.md](./adding-a-tool.md) for the full step-by-step, including implementation file, TypeBox schema, classifications and HITL implications, tests, and the UI wiring needed only when the tool has per-agent settings.

A separate **user-installed** path — dropping a module into `server/tools/user/` without forking — is fully wired: `npm run scaffold:tool -- <name>`, edit, restart, and the tool appears in the picker. See [user-tools-guide.md](./user-tools-guide.md).

## Connections

- Sends to: Agent Node
- Receives from: None
- At most one Tool Node should be connected to an agent. If multiple are connected, only the first is used.

## Example

```json
{
  "type": "tools",
  "label": "Coding Tools",
  "profile": "coding",
  "enabledTools": ["calculator"],
  "enabledGroups": ["web"],
  "skills": [
    {
      "id": "code-review",
      "name": "Code Review",
      "content": "When reviewing code, check for security vulnerabilities, performance issues, and readability.",
      "injectAs": "system-prompt"
    }
  ],
  "plugins": [],
  "subAgentSpawning": false,
  "maxSubAgents": 3
}
```
