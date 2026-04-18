# Tool Node

> Configures which tools an agent can use through profiles, groups, direct enables, skills, and plugins.

<!-- source: src/types/nodes.ts#ToolsNodeData -->
<!-- last-verified: 2026-04-18 -->

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
| `enabledTools` | `string[]` | `[]` | Individual tool names to enable beyond the profile |
| `enabledGroups` | `ToolGroup[]` | `[]` | Additional tool groups to enable beyond the profile |
| `skills` | `SkillDefinition[]` | `[]` | Skill definitions that are folded into prompt assembly |
| `plugins` | `PluginDefinition[]` | `[]` | Plugin bundles that contribute tools, skills, and optional hooks |
| `subAgentSpawning` | `boolean` | `false` | Whether the agent may spawn sub-agents |
| `maxSubAgents` | `number` | `3` | Maximum concurrent sub-agents |
| `toolSettings.canva.portRangeStart` | `number` | `5173` | Lower bound of the port range canva auto-picks from |
| `toolSettings.canva.portRangeEnd` | `number` | `5273` | Upper bound of the port range canva auto-picks from |
| `toolSettings.canva.skill` | `string` | `""` | Markdown guidance injected into the system prompt for the canva tool |
| `toolSettings.textToSpeech.preferredProvider` | `string` | `""` | Default TTS provider: `openai`, `elevenlabs`, `google`, `microsoft`, or `minimax` |
| `toolSettings.textToSpeech.elevenLabsApiKey` | `string` | `""` | ElevenLabs API key. Empty reads `ELEVENLABS_API_KEY` from env |
| `toolSettings.textToSpeech.elevenLabsDefaultVoice` | `string` | `""` | ElevenLabs voice id (e.g. `21m00Tcm4TlvDq8ikWAM`) |
| `toolSettings.textToSpeech.openaiVoice` | `string` | `""` | OpenAI TTS voice (e.g. `alloy`). Uses the image-tool OpenAI API key |
| `toolSettings.textToSpeech.openaiModel` | `string` | `""` | OpenAI TTS model (e.g. `gpt-4o-mini-tts`) |
| `toolSettings.textToSpeech.geminiVoice` | `string` | `""` | Google Gemini TTS voice. Uses the image-tool Gemini API key |
| `toolSettings.textToSpeech.microsoftApiKey` | `string` | `""` | Azure Speech key. Empty reads `AZURE_SPEECH_KEY` from env |
| `toolSettings.textToSpeech.microsoftRegion` | `string` | `""` | Azure region, e.g. `eastus` |
| `toolSettings.textToSpeech.minimaxApiKey` | `string` | `""` | MiniMax API key. Empty reads `MINIMAX_API_KEY` from env |
| `toolSettings.textToSpeech.minimaxGroupId` | `string` | `""` | MiniMax group id. Empty reads `MINIMAX_GROUP_ID` from env |
| `toolSettings.textToSpeech.skill` | `string` | `""` | Markdown guidance injected into the system prompt for text_to_speech |
| `toolSettings.musicGenerate.preferredProvider` | `string` | `""` | Default music provider: `google` or `minimax` |
| `toolSettings.musicGenerate.geminiModel` | `string` | `""` | Google Lyria model override (reuses the image-tool Gemini API key) |
| `toolSettings.musicGenerate.minimaxModel` | `string` | `""` | MiniMax music model override, e.g. `music-01` (reuses the text_to_speech MiniMax key and group id) |
| `toolSettings.musicGenerate.skill` | `string` | `""` | Markdown guidance injected into the system prompt for music_generate |

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
- `text_to_speech` synthesizes audio via ElevenLabs, Google Gemini, Microsoft Azure, MiniMax, or OpenAI and writes the resulting file into `<cwd>/audio/`
- `music_generate` generates music or ambient audio via Google Lyria or MiniMax Music and writes the resulting file into `<cwd>/music/`. The Gemini API key is reused from the image settings, and the MiniMax API key and group id are reused from text_to_speech
- most other tools are still stubs
- if the resolved tool list already includes `web_search` or `web_fetch` and the active provider plugin supplies replacements, `createAgentTools()` swaps in the provider-backed implementation instead of auto-adding new tools

Tool skills from the Tool Node and connected Skills Nodes are merged during `resolveAgentConfig()` and then folded into the system prompt by `buildSystemPrompt()`.

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
