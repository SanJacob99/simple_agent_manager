import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Terminal, Code2, Globe, Image, Users, LayoutDashboard, Volume2, ShieldAlert, Music } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import { buildProviderCatalogKey, useModelCatalogStore } from '../../store/model-catalog-store';
import { useSettingsStore } from '../../settings/settings-store';
import type { ToolsNodeData, ToolProfile, ToolGroup } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';
import { ALL_TOOL_NAMES, TOOL_GROUPS, TOOL_PROFILES } from '../../../shared/resolve-tool-names';
import { SchemaForm } from './schema-form/SchemaForm';
import {
  canvaToolConfigSchema,
  codeExecutionToolConfigSchema,
  execToolConfigSchema,
  webSearchToolConfigSchema,
} from './tool-config-schemas';

const DEFAULT_EXEC_SETTINGS = { cwd: '', sandboxWorkdir: false, skill: '' };
const DEFAULT_CODE_EXECUTION_SETTINGS = { apiKey: '', model: '', skill: '' };
const DEFAULT_WEB_SEARCH_SETTINGS = { tavilyApiKey: '', skill: '' };
const DEFAULT_CANVA_SETTINGS = { portRangeStart: 5173, portRangeEnd: 5273, skill: '' };

const HITL_TOOLS = new Set(['ask_user', 'confirm_action']);

const PROFILES: ToolProfile[] = ['full', 'coding', 'messaging', 'minimal', 'custom'];
const GROUPS: ToolGroup[] = ['runtime', 'fs', 'web', 'coding', 'media', 'communication', 'human'];

type Page = 'main' | 'exec' | 'code_execution' | 'web_search' | 'image' | 'canva' | 'text_to_speech' | 'music_generate' | 'sub_agents';

const TTS_DEFAULTS = {
  preferredProvider: '' as const,
  elevenLabsApiKey: '',
  elevenLabsDefaultVoice: '',
  elevenLabsDefaultModel: '',
  openaiVoice: '',
  openaiModel: '',
  geminiVoice: '',
  geminiModel: '',
  microsoftApiKey: '',
  microsoftRegion: '',
  microsoftDefaultVoice: '',
  minimaxApiKey: '',
  minimaxGroupId: '',
  minimaxDefaultVoice: '',
  minimaxDefaultModel: '',
  skill: '',
};

const MUSIC_DEFAULTS = {
  preferredProvider: '' as const,
  geminiModel: '',
  minimaxModel: '',
  skill: '',
};

interface Props {
  nodeId: string;
  data: ToolsNodeData;
}

// ---------------------------------------------------------------------------
// Page header with back button
// ---------------------------------------------------------------------------

function PageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1.5 mb-2 text-xs text-slate-400 hover:text-slate-200 transition"
    >
      <ChevronLeft size={14} />
      <span className="font-semibold">{title}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page link row
// ---------------------------------------------------------------------------

function PageLink({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-2 text-left transition hover:border-slate-600 hover:bg-slate-800"
    >
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 text-xs text-slate-300">{label}</span>
      {hint && <span className="text-[9px] text-slate-600">{hint}</span>}
      <ChevronRight size={12} className="text-slate-600" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ToolsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const edges = useGraphStore((s) => s.edges);
  const allNodes = useGraphStore((s) => s.nodes);
  const allowDisableHitl = useSettingsStore((s) => s.safety.allowDisableHitl);
  const [page, setPage] = useState<Page>('main');
  const [customTool, setCustomTool] = useState('');

  // Resolve the agent node's workingDirectory that this tools node inherits from
  const agentWorkingDir = (() => {
    const outEdge = edges.find((e) => e.source === nodeId);
    if (!outEdge) return '';
    const agentNode = allNodes.find((n) => n.id === outEdge.target && n.data.type === 'agent');
    return (agentNode?.data as { workingDirectory?: string })?.workingDirectory ?? '';
  })();

  // Resolve the connected agent's provider for image generation model selection
  const modelsByKey = useModelCatalogStore((s) => s.models);
  const connectedProvider = useMemo(() => {
    // Walk: tools → agent (outgoing edge from tools)
    const toAgentEdge = edges.find((e) => e.source === nodeId);
    if (!toAgentEdge) return null;
    const agentNode = allNodes.find((n) => n.id === toAgentEdge.target && n.data.type === 'agent');
    if (!agentNode) return null;

    // Find provider among all nodes connected to the agent.
    // Multiple edges point to the agent (context, storage, provider, tools) —
    // find the one whose SOURCE is a provider node.
    const incomingEdges = edges.filter((e) => e.target === agentNode.id);
    for (const edge of incomingEdges) {
      const source = allNodes.find((n) => n.id === edge.source);
      if (source?.data.type === 'provider') {
        return {
          pluginId: (source.data as { pluginId?: string }).pluginId ?? '',
          baseUrl: (source.data as { baseUrl?: string }).baseUrl ?? '',
        };
      }
    }
    return null;
  }, [edges, allNodes, nodeId]);

  // Filter catalog for image-capable models
  const imageCapableModels = useMemo(() => {
    if (!connectedProvider) return [];
    const key = buildProviderCatalogKey(connectedProvider);
    const models = modelsByKey[key] ?? {};
    return Object.entries(models)
      .filter(([, metadata]) => metadata.outputModalities?.includes('image'))
      .map(([id, metadata]) => ({ id, name: metadata.name ?? id }));
  }, [connectedProvider, modelsByKey]);

  // Effective groups
  const profileGroups = (TOOL_PROFILES[data.profile] ?? []) as ToolGroup[];
  const effectiveGroups = data.enabledGroups.length > 0
    ? data.enabledGroups
    : profileGroups;

  const toggleGroup = (group: ToolGroup) => {
    const base = new Set<ToolGroup>(effectiveGroups);
    if (base.has(group)) base.delete(group);
    else base.add(group);
    const newGroups = GROUPS.filter((g) => base.has(g));
    update(nodeId, { enabledGroups: newGroups, profile: 'custom' as ToolProfile });
  };

  const toggleTool = (tool: string) => {
    // HITL tools are locked on unless "Dangerous Fully Auto" is enabled in Settings.
    if (HITL_TOOLS.has(tool) && !allowDisableHitl) return;
    const tools = data.enabledTools.includes(tool)
      ? data.enabledTools.filter((t) => t !== tool)
      : [...data.enabledTools, tool];
    update(nodeId, { enabledTools: tools });
  };

  const addCustomTool = () => {
    if (customTool.trim() && !data.enabledTools.includes(customTool.trim())) {
      update(nodeId, { enabledTools: [...data.enabledTools, customTool.trim()] });
      setCustomTool('');
    }
  };

  // Helper for updating nested toolSettings
  const updateExec = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        exec: { ...(data.toolSettings?.exec ?? { cwd: '', sandboxWorkdir: false, skill: '' }), ...patch },
      },
    });
  };

  const updateCodeExecution = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        codeExecution: { ...(data.toolSettings?.codeExecution ?? { apiKey: '', model: '', skill: '' }), ...patch },
      },
    });
  };

  const updateWebSearch = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        webSearch: { ...(data.toolSettings?.webSearch ?? { tavilyApiKey: '', skill: '' }), ...patch },
      },
    });
  };

  const updateImage = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        image: { ...(data.toolSettings?.image ?? { openaiApiKey: '', geminiApiKey: '', preferredModel: '', skill: '' }), ...patch },
      },
    });
  };

  const updateCanva = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        canva: {
          ...(data.toolSettings?.canva ?? { portRangeStart: 5173, portRangeEnd: 5273, skill: '' }),
          ...patch,
        },
      },
    });
  };

  const updateTextToSpeech = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        textToSpeech: {
          ...(data.toolSettings?.textToSpeech ?? TTS_DEFAULTS),
          ...patch,
        },
      },
    });
  };

  const updateMusicGenerate = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        musicGenerate: {
          ...(data.toolSettings?.musicGenerate ?? MUSIC_DEFAULTS),
          ...patch,
        },
      },
    });
  };

  // -------------------------------------------------------------------------
  // Page: exec settings
  // -------------------------------------------------------------------------
  if (page === 'exec') {
    return (
      <div className="space-y-1">
        <PageHeader title="exec / bash" onBack={() => setPage('main')} />
        <SchemaForm
          schema={execToolConfigSchema}
          value={data.toolSettings?.exec ?? DEFAULT_EXEC_SETTINGS}
          onChange={updateExec}
          fieldOverrides={{
            cwd: {
              placeholder: agentWorkingDir || 'Inherited from agent node',
              description: agentWorkingDir
                ? `Inherits: ${agentWorkingDir} — set a value here to override.`
                : "Leave empty to use the agent node's working directory.",
            },
          }}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: code_execution settings
  // -------------------------------------------------------------------------
  if (page === 'code_execution') {
    return (
      <div className="space-y-1">
        <PageHeader title="code_execution" onBack={() => setPage('main')} />
        <SchemaForm
          schema={codeExecutionToolConfigSchema}
          value={data.toolSettings?.codeExecution ?? DEFAULT_CODE_EXECUTION_SETTINGS}
          onChange={updateCodeExecution}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: web_search settings
  // -------------------------------------------------------------------------
  if (page === 'web_search') {
    return (
      <div className="space-y-1">
        <PageHeader title="web_search" onBack={() => setPage('main')} />
        <SchemaForm
          schema={webSearchToolConfigSchema}
          value={data.toolSettings?.webSearch ?? DEFAULT_WEB_SEARCH_SETTINGS}
          onChange={updateWebSearch}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: image settings
  // -------------------------------------------------------------------------
  if (page === 'image') {
    return (
      <div className="space-y-1">
        <PageHeader title="image / image_generate" onBack={() => setPage('main')} />

        <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">image</strong> (analysis) loads an image so the model can see it.
            Requires a vision-capable model.
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            <strong className="text-slate-300">image_generate</strong> creates images via configured providers.
            Set at least one API key below. Use action "list" at runtime to inspect available providers.
          </p>
        </div>

        {/* Model selection — uses connected agent's provider catalog */}
        <Field label="Preferred Model">
          {connectedProvider?.pluginId === 'openrouter' && imageCapableModels.length > 0 ? (
            <>
              <select
                className={selectClass}
                value={data.toolSettings?.image?.preferredModel ?? ''}
                onChange={(e) => updateImage({ preferredModel: e.target.value })}
              >
                <option value="">(no preference — use first available)</option>
                {imageCapableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[9px] text-slate-600">
                {imageCapableModels.length} image-capable model{imageCapableModels.length !== 1 ? 's' : ''} from OpenRouter catalog.
                Agent's OPENROUTER_API_KEY is reused.
              </p>
            </>
          ) : connectedProvider?.pluginId === 'openrouter' ? (
            <>
              <input
                className={inputClass}
                value={data.toolSettings?.image?.preferredModel ?? ''}
                onChange={(e) => updateImage({ preferredModel: e.target.value })}
                placeholder="e.g. openai/gpt-image-1"
              />
              <p className="mt-0.5 text-[9px] text-amber-500/80">
                OpenRouter catalog not loaded. Open Settings → Model Catalog to sync, then return here for a filtered picker.
              </p>
            </>
          ) : connectedProvider ? (
            <>
              <input
                className={inputClass}
                value={data.toolSettings?.image?.preferredModel ?? ''}
                onChange={(e) => updateImage({ preferredModel: e.target.value })}
                placeholder="e.g. openai/gpt-image-1 or google/gemini-2.0-flash-exp"
              />
              <p className="mt-0.5 text-[9px] text-slate-600">
                Connected provider: <span className="text-slate-400">{connectedProvider.pluginId}</span>.
                Model selection uses direct API keys below.
              </p>
            </>
          ) : (
            <>
              <input
                className={inputClass}
                value={data.toolSettings?.image?.preferredModel ?? ''}
                onChange={(e) => updateImage({ preferredModel: e.target.value })}
                placeholder="e.g. openai/gpt-image-1"
              />
              <p className="mt-0.5 text-[9px] text-amber-500/80">
                No agent connected. Connect this Tools node to an agent with a provider to see available models.
              </p>
            </>
          )}
        </Field>

        <Field label="OpenAI API Key">
          <input
            className={inputClass}
            type="password"
            value={data.toolSettings?.image?.openaiApiKey ?? ''}
            onChange={(e) => updateImage({ openaiApiKey: e.target.value })}
            placeholder="Empty = reads OPENAI_API_KEY from env"
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            For DALL-E / gpt-image-1. Supports edit mode with up to 5 reference images.
          </p>
        </Field>

        <Field label="Google / Gemini API Key">
          <input
            className={inputClass}
            type="password"
            value={data.toolSettings?.image?.geminiApiKey ?? ''}
            onChange={(e) => updateImage({ geminiApiKey: e.target.value })}
            placeholder="Empty = reads GEMINI_API_KEY from env"
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            For Gemini image generation. Supports edit mode.
          </p>
        </Field>

        <Field label="Skill">
          <textarea
            className={textareaClass}
            rows={4}
            value={data.toolSettings?.image?.skill ?? ''}
            onChange={(e) => updateImage({ skill: e.target.value })}
            placeholder="Markdown guidance for how the agent should use image tools..."
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Injected into the system prompt to guide image tool usage.
          </p>
        </Field>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: canva settings
  // -------------------------------------------------------------------------
  if (page === 'canva') {
    return (
      <div className="space-y-1">
        <PageHeader title="canva" onBack={() => setPage('main')} />

        <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">canva</strong> lets the agent build small HTML/CSS/JS
            visualizations and serve them on a local port. Files are written under
            <span className="font-mono"> &lt;cwd&gt;/.canva/&lt;name&gt;/</span>.
          </p>
        </div>

        <SchemaForm
          schema={canvaToolConfigSchema}
          value={data.toolSettings?.canva ?? DEFAULT_CANVA_SETTINGS}
          onChange={updateCanva}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: text_to_speech settings
  // -------------------------------------------------------------------------
  if (page === 'text_to_speech') {
    const tts = data.toolSettings?.textToSpeech ?? TTS_DEFAULTS;
    return (
      <div className="space-y-1">
        <PageHeader title="text_to_speech" onBack={() => setPage('main')} />

        <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2 space-y-1">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">text_to_speech</strong> turns outbound text into
            audio via one of five providers. Configure at least one API key below. OpenAI and
            Gemini keys are shared with the image tool.
          </p>
          <p className="text-[10px] text-slate-500">
            Audio is written under <span className="font-mono">&lt;cwd&gt;/audio/</span>.
          </p>
        </div>

        <Field label="Preferred provider">
          <select
            className={selectClass}
            value={tts.preferredProvider ?? ''}
            onChange={(e) => updateTextToSpeech({ preferredProvider: e.target.value })}
          >
            <option value="">(first configured)</option>
            <option value="openai">OpenAI</option>
            <option value="elevenlabs">ElevenLabs</option>
            <option value="google">Google Gemini</option>
            <option value="microsoft">Microsoft Azure</option>
            <option value="minimax">MiniMax</option>
          </select>
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">ElevenLabs</p>
        </div>
        <Field label="API Key">
          <input
            className={inputClass}
            type="password"
            value={tts.elevenLabsApiKey ?? ''}
            onChange={(e) => updateTextToSpeech({ elevenLabsApiKey: e.target.value })}
            placeholder="Empty = reads ELEVENLABS_API_KEY from env"
          />
        </Field>
        <Field label="Default voice ID">
          <input
            className={inputClass}
            value={tts.elevenLabsDefaultVoice ?? ''}
            onChange={(e) => updateTextToSpeech({ elevenLabsDefaultVoice: e.target.value })}
            placeholder="21m00Tcm4TlvDq8ikWAM (Rachel)"
          />
        </Field>
        <Field label="Default model">
          <input
            className={inputClass}
            value={tts.elevenLabsDefaultModel ?? ''}
            onChange={(e) => updateTextToSpeech({ elevenLabsDefaultModel: e.target.value })}
            placeholder="eleven_multilingual_v2"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">OpenAI</p>
          <p className="text-[9px] text-slate-600">
            Reuses the OpenAI API key from the image settings.
          </p>
        </div>
        <Field label="Voice">
          <input
            className={inputClass}
            value={tts.openaiVoice ?? ''}
            onChange={(e) => updateTextToSpeech({ openaiVoice: e.target.value })}
            placeholder="alloy, nova, shimmer, echo, fable, onyx"
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass}
            value={tts.openaiModel ?? ''}
            onChange={(e) => updateTextToSpeech({ openaiModel: e.target.value })}
            placeholder="gpt-4o-mini-tts (default)"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">Google Gemini</p>
          <p className="text-[9px] text-slate-600">
            Reuses the Gemini API key from the image settings.
          </p>
        </div>
        <Field label="Voice">
          <input
            className={inputClass}
            value={tts.geminiVoice ?? ''}
            onChange={(e) => updateTextToSpeech({ geminiVoice: e.target.value })}
            placeholder="Kore, Puck, Charon, Fenrir, …"
          />
        </Field>
        <Field label="Model">
          <input
            className={inputClass}
            value={tts.geminiModel ?? ''}
            onChange={(e) => updateTextToSpeech({ geminiModel: e.target.value })}
            placeholder="gemini-2.5-flash-preview-tts"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">Microsoft Azure</p>
        </div>
        <Field label="API Key">
          <input
            className={inputClass}
            type="password"
            value={tts.microsoftApiKey ?? ''}
            onChange={(e) => updateTextToSpeech({ microsoftApiKey: e.target.value })}
            placeholder="Empty = reads AZURE_SPEECH_KEY from env"
          />
        </Field>
        <Field label="Region">
          <input
            className={inputClass}
            value={tts.microsoftRegion ?? ''}
            onChange={(e) => updateTextToSpeech({ microsoftRegion: e.target.value })}
            placeholder="eastus"
          />
        </Field>
        <Field label="Default voice">
          <input
            className={inputClass}
            value={tts.microsoftDefaultVoice ?? ''}
            onChange={(e) => updateTextToSpeech({ microsoftDefaultVoice: e.target.value })}
            placeholder="en-US-JennyNeural"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">MiniMax</p>
        </div>
        <Field label="API Key">
          <input
            className={inputClass}
            type="password"
            value={tts.minimaxApiKey ?? ''}
            onChange={(e) => updateTextToSpeech({ minimaxApiKey: e.target.value })}
            placeholder="Empty = reads MINIMAX_API_KEY from env"
          />
        </Field>
        <Field label="Group ID">
          <input
            className={inputClass}
            value={tts.minimaxGroupId ?? ''}
            onChange={(e) => updateTextToSpeech({ minimaxGroupId: e.target.value })}
            placeholder="Empty = reads MINIMAX_GROUP_ID from env"
          />
        </Field>
        <Field label="Default voice">
          <input
            className={inputClass}
            value={tts.minimaxDefaultVoice ?? ''}
            onChange={(e) => updateTextToSpeech({ minimaxDefaultVoice: e.target.value })}
            placeholder="male-qn-qingse"
          />
        </Field>
        <Field label="Default model">
          <input
            className={inputClass}
            value={tts.minimaxDefaultModel ?? ''}
            onChange={(e) => updateTextToSpeech({ minimaxDefaultModel: e.target.value })}
            placeholder="speech-02-hd"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2" />
        <Field label="Skill">
          <textarea
            className={textareaClass}
            rows={4}
            value={tts.skill ?? ''}
            onChange={(e) => updateTextToSpeech({ skill: e.target.value })}
            placeholder="Markdown guidance for how the agent should use text_to_speech..."
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Injected into the system prompt to guide TTS usage.
          </p>
        </Field>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: music_generate settings
  // -------------------------------------------------------------------------
  if (page === 'music_generate') {
    const music = data.toolSettings?.musicGenerate ?? MUSIC_DEFAULTS;
    return (
      <div className="space-y-1">
        <PageHeader title="music_generate" onBack={() => setPage('main')} />

        <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2 space-y-1">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">music_generate</strong> turns prompts into
            music or ambient audio via Google Lyria or MiniMax Music. The Gemini API key is
            shared with the image tool; the MiniMax API key and group id are shared with
            text_to_speech.
          </p>
          <p className="text-[10px] text-slate-500">
            Audio is written under <span className="font-mono">&lt;cwd&gt;/music/</span>.
          </p>
        </div>

        <Field label="Preferred provider">
          <select
            className={selectClass}
            value={music.preferredProvider ?? ''}
            onChange={(e) => updateMusicGenerate({ preferredProvider: e.target.value })}
          >
            <option value="">(first configured)</option>
            <option value="google">Google Lyria</option>
            <option value="minimax">MiniMax Music</option>
          </select>
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">Google Lyria</p>
          <p className="text-[9px] text-slate-600">
            Reuses the Gemini API key from the image settings.
          </p>
        </div>
        <Field label="Model">
          <input
            className={inputClass}
            value={music.geminiModel ?? ''}
            onChange={(e) => updateMusicGenerate({ geminiModel: e.target.value })}
            placeholder="lyria-002 (default)"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2">
          <p className="text-[10px] font-semibold text-slate-400">MiniMax Music</p>
          <p className="text-[9px] text-slate-600">
            Reuses the MiniMax API key and group id from text_to_speech.
          </p>
        </div>
        <Field label="Model">
          <input
            className={inputClass}
            value={music.minimaxModel ?? ''}
            onChange={(e) => updateMusicGenerate({ minimaxModel: e.target.value })}
            placeholder="music-01 (default)"
          />
        </Field>

        <div className="mt-2 border-t border-slate-700/40 pt-2" />
        <Field label="Skill">
          <textarea
            className={textareaClass}
            rows={4}
            value={music.skill ?? ''}
            onChange={(e) => updateMusicGenerate({ skill: e.target.value })}
            placeholder="Markdown guidance for how the agent should use music_generate..."
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Injected into the system prompt to guide music generation usage.
          </p>
        </Field>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: sub-agents
  // -------------------------------------------------------------------------
  if (page === 'sub_agents') {
    return (
      <div className="space-y-1">
        <PageHeader title="Sub-Agents" onBack={() => setPage('main')} />

        <Field label="Sub-Agent Spawning">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.subAgentSpawning}
              onChange={(e) => update(nodeId, { subAgentSpawning: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
            />
            <span className="text-xs text-slate-300">Enable sub-agent spawning</span>
          </label>
        </Field>

        {data.subAgentSpawning && (
          <Field label="Max Sub-Agents">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={10}
              value={data.maxSubAgents}
              onChange={(e) =>
                update(nodeId, { maxSubAgents: parseInt(e.target.value) || 3 })
              }
            />
          </Field>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Page: main
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-1">
      <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2 space-y-1.5">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          <strong className="text-slate-300">Tools</strong> give the agent actions it can take —
          filesystem I/O, shell commands, web search, image generation, and more. Enable only what
          the agent needs so the system prompt stays small and tool selection stays focused.
        </p>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          <strong className="text-slate-300">Skills</strong> are short markdown instructions that
          teach the model <em>when</em> and <em>how</em> to use a tool — naming conventions, safety
          rails, preferred flags. A tool without a skill is available but opaque; with a skill, the
          model invokes it at the right moments with the right arguments.
        </p>
        <div className="rounded border border-slate-700/40 bg-slate-900/40 px-2 py-1.5 mt-1">
          <p className="text-[9px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
            Example
          </p>
          <p className="text-[10px] text-slate-400 leading-snug">
            Enabling <span className="font-mono text-slate-300">exec</span> alone lets the agent
            run shell commands — but it may pick wrong ones. Adding a skill like
            <span className="block mt-0.5 font-mono text-[9px] text-slate-500">
              "Use exec for read-only inspection (ls, cat). Never rm or sudo. Always pass cwd."
            </span>
            turns the tool into a directed capability the model uses safely and predictably.
          </p>
        </div>
      </div>

      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      {/* Profile selector */}
      <Field label="Tool Profile">
        <select
          className={selectClass}
          value={data.profile}
          onChange={(e) => {
            const profile = e.target.value as ToolProfile;
            const groups = profile === 'custom'
              ? effectiveGroups
              : (TOOL_PROFILES[profile] ?? []) as ToolGroup[];
            update(nodeId, { profile, enabledGroups: groups });
          }}
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-slate-600">
          {data.profile === 'full' && 'All tool groups enabled'}
          {data.profile === 'coding' && 'Runtime, filesystem, coding, memory'}
          {data.profile === 'messaging' && 'Web, communication, memory'}
          {data.profile === 'minimal' && 'Web only'}
          {data.profile === 'custom' && 'Select individual tools below'}
        </p>
      </Field>

      {/* Tool Groups */}
      <Field label="Tool Groups">
        <div className="space-y-1">
          {GROUPS.map((group) => (
            <label key={group} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={effectiveGroups.includes(group)}
                onChange={() => toggleGroup(group)}
                className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
              />
              <span className="text-xs text-slate-300">
                {group}
                <span className="text-slate-600 ml-1">
                  ({TOOL_GROUPS[group].join(', ')})
                </span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      {/* Individual tools (when custom profile) */}
      {data.profile === 'custom' && (
        <Field label="Individual Tools">
          {!allowDisableHitl && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 mb-2">
              <ShieldAlert size={11} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[9px] text-slate-400 leading-snug">
                <strong className="text-amber-300">HITL locked on.</strong> `ask_user` and `confirm_action` stay checked
                so the agent must get human approval before risky actions. Enable <em>"Dangerous Fully Auto"</em> in
                Settings → Safety to unlock.
              </p>
            </div>
          )}
          <div className="space-y-1">
            {ALL_TOOL_NAMES.map((tool) => {
              const isHitl = HITL_TOOLS.has(tool);
              const locked = isHitl && !allowDisableHitl;
              return (
                <label
                  key={tool}
                  className={`flex items-center gap-2 ${locked ? 'cursor-not-allowed' : ''}`}
                  title={locked ? 'Locked by Safety settings — enable Dangerous Fully Auto to uncheck.' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={data.enabledTools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                    disabled={locked}
                    className={`rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30 ${
                      locked ? 'opacity-70' : ''
                    }`}
                  />
                  <span className={`text-xs ${locked ? 'text-slate-400' : 'text-slate-300'}`}>
                    {tool}
                    {isHitl && (
                      <span className="ml-1 text-[9px] text-amber-400/80">(safety)</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              className={inputClass}
              value={customTool}
              onChange={(e) => setCustomTool(e.target.value)}
              placeholder="custom_tool_name"
              onKeyDown={(e) => e.key === 'Enter' && addCustomTool()}
            />
            <button
              onClick={addCustomTool}
              className="shrink-0 rounded-md bg-slate-700 px-2.5 text-xs text-slate-300 transition hover:bg-slate-600"
            >
              Add
            </button>
          </div>
        </Field>
      )}

      {/* Navigation to config pages */}
      <Field label="Configure">
        <div className="space-y-1.5">
          <PageLink
            icon={<Terminal size={14} />}
            label="exec / bash"
            hint={data.toolSettings?.exec?.cwd || undefined}
            onClick={() => setPage('exec')}
          />
          <PageLink
            icon={<Code2 size={14} />}
            label="code_execution"
            hint={data.toolSettings?.codeExecution?.apiKey ? 'key set' : undefined}
            onClick={() => setPage('code_execution')}
          />
          <PageLink
            icon={<Globe size={14} />}
            label="web_search"
            hint={data.toolSettings?.webSearch?.tavilyApiKey ? 'tavily' : 'duckduckgo'}
            onClick={() => setPage('web_search')}
          />
          <PageLink
            icon={<Image size={14} />}
            label="image / image_generate"
            hint={(() => {
              const keys = [];
              if (data.toolSettings?.image?.openaiApiKey) keys.push('openai');
              if (data.toolSettings?.image?.geminiApiKey) keys.push('google');
              return keys.length > 0 ? keys.join(', ') : undefined;
            })()}
            onClick={() => setPage('image')}
          />
          <PageLink
            icon={<Volume2 size={14} />}
            label="text_to_speech"
            hint={(() => {
              const tts = data.toolSettings?.textToSpeech;
              if (!tts) return undefined;
              const configured: string[] = [];
              if (tts.elevenLabsApiKey) configured.push('elevenlabs');
              if (tts.microsoftApiKey) configured.push('azure');
              if (tts.minimaxApiKey) configured.push('minimax');
              return configured.length > 0 ? configured.join(', ') : undefined;
            })()}
            onClick={() => setPage('text_to_speech')}
          />
          <PageLink
            icon={<Music size={14} />}
            label="music_generate"
            hint={(() => {
              const music = data.toolSettings?.musicGenerate;
              if (!music) return undefined;
              const preferred = music.preferredProvider;
              return preferred ? preferred : undefined;
            })()}
            onClick={() => setPage('music_generate')}
          />
          <PageLink
            icon={<LayoutDashboard size={14} />}
            label="canva"
            hint={(() => {
              const start = data.toolSettings?.canva?.portRangeStart;
              const end = data.toolSettings?.canva?.portRangeEnd;
              return start && end ? `${start}-${end}` : undefined;
            })()}
            onClick={() => setPage('canva')}
          />
          <PageLink
            icon={<Users size={14} />}
            label="Sub-Agents"
            hint={data.subAgentSpawning ? 'on' : undefined}
            onClick={() => setPage('sub_agents')}
          />
        </div>
      </Field>
    </div>
  );
}
