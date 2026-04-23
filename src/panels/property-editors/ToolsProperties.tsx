import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Terminal, Code2, Globe, Image, Users, LayoutDashboard, Volume2, ShieldAlert, Music, Chrome } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import { buildProviderCatalogKey, useModelCatalogStore } from '../../store/model-catalog-store';
import { useSettingsStore } from '../../settings/settings-store';
import type { ToolsNodeData, ToolProfile, ToolGroup } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';
import { TOOL_GROUPS, TOOL_PROFILES, canonicalizeToolName } from '../../../shared/resolve-tool-names';
import { useToolCatalogStore } from '../../store/tool-catalog-store';
import type { ToolCatalogEntry } from '../../../shared/tool-catalog';
import { SchemaForm } from './schema-form/SchemaForm';
import {
  browserToolConfigSchema,
  canvaToolConfigSchema,
  codeExecutionToolConfigSchema,
  execToolConfigSchema,
  imageToolConfigSchema,
  musicGenerateToolConfigSchema,
  subAgentsToolConfigSchema,
  textToSpeechToolConfigSchema,
  webSearchToolConfigSchema,
} from './tool-config-schemas';

const DEFAULT_EXEC_SETTINGS = { cwd: '', sandboxWorkdir: false, skill: '' };
const DEFAULT_CODE_EXECUTION_SETTINGS = { apiKey: '', model: '', skill: '' };
const DEFAULT_WEB_SEARCH_SETTINGS = { tavilyApiKey: '', skill: '' };
const DEFAULT_CANVA_SETTINGS = { portRangeStart: 5173, portRangeEnd: 5273, skill: '' };
const DEFAULT_BROWSER_SETTINGS = {
  userDataDir: '',
  viewportWidth: 1280,
  viewportHeight: 800,
  timeoutMs: 30000,
  autoScreenshot: true,
  screenshotFormat: 'jpeg' as const,
  screenshotQuality: 60,
  skill: '',
};
const DEFAULT_IMAGE_SETTINGS = {
  openaiApiKey: '',
  geminiApiKey: '',
  preferredModel: '',
  skill: '',
};

const HITL_TOOLS = new Set(['ask_user', 'confirm_action']);

const PROFILES: ToolProfile[] = ['full', 'coding', 'messaging', 'minimal', 'custom'];
const GROUPS: ToolGroup[] = ['runtime', 'fs', 'web', 'coding', 'media', 'communication', 'human'];

type Page = 'main' | 'exec' | 'code_execution' | 'web_search' | 'image' | 'canva' | 'browser' | 'text_to_speech' | 'music_generate' | 'sub_agents';

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
  openrouterVoice: '',
  openrouterModel: '',
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

  // Live tool catalog — includes every ToolModule registered at server
  // startup (built-ins + any user-installed `server/tools/user/*.module.ts`).
  // Falls back to a synthetic list of built-in names when the backend
  // hasn't answered yet, so the picker is never empty on first render.
  const toolCatalog = useToolCatalogStore((s) => s.entriesOrFallback());
  const groupedToolEntries = useMemo(() => {
    const buckets = new Map<string | undefined, ToolCatalogEntry[]>();
    for (const entry of toolCatalog) {
      const arr = buckets.get(entry.group) ?? [];
      arr.push(entry);
      buckets.set(entry.group, arr);
    }
    const out: Array<{ label: string; entries: ToolCatalogEntry[] }> = [];
    // Render known groups in the shared canonical order so the picker
    // layout is stable across built-in reshuffles.
    for (const g of Object.keys(TOOL_GROUPS)) {
      const entries = buckets.get(g);
      if (entries) {
        out.push({ label: g, entries });
        buckets.delete(g);
      }
    }
    // User-declared groups (alphabetical) come after the known ones.
    const remainingGroups = [...buckets.keys()]
      .filter((k): k is string => typeof k === 'string')
      .sort((a, b) => a.localeCompare(b));
    for (const g of remainingGroups) {
      out.push({ label: g, entries: buckets.get(g)! });
      buckets.delete(g);
    }
    const ungrouped = buckets.get(undefined);
    if (ungrouped && ungrouped.length > 0) {
      out.push({ label: 'other', entries: ungrouped });
    }
    return out;
  }, [toolCatalog]);

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
    // A click counts as "present" if the saved list has either the
    // canonical tool name or any of its aliases. Toggling off sweeps
    // out every alias form so legacy aliases don't silently re-enable
    // the tool on the next render.
    const isPresent = data.enabledTools.some(
      (saved) => saved === tool || canonicalizeToolName(saved) === tool,
    );
    const tools = isPresent
      ? data.enabledTools.filter(
          (saved) => saved !== tool && canonicalizeToolName(saved) !== tool,
        )
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

  const updateBrowser = (patch: Record<string, unknown>) => {
    update(nodeId, {
      toolSettings: {
        ...data.toolSettings,
        browser: {
          ...(data.toolSettings?.browser ?? DEFAULT_BROWSER_SETTINGS),
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
    // The preferred-model picker stays hand-written: it switches between
    // an input and a catalog-filtered select depending on the connected
    // provider, with four different hint texts. The SchemaForm below
    // handles the API keys and skill field.
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

        <SchemaForm
          schema={imageToolConfigSchema}
          value={data.toolSettings?.image ?? DEFAULT_IMAGE_SETTINGS}
          onChange={updateImage}
        />
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
  // Page: browser settings
  // -------------------------------------------------------------------------
  if (page === 'browser') {
    return (
      <div className="space-y-1">
        <PageHeader title="browser" onBack={() => setPage('main')} />

        <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-3 py-2 mb-2 space-y-1">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">browser</strong> drives a real headless Chromium
            via Playwright. The agent navigates, inspects via <em>snapshot</em> or{' '}
            <em>screenshot</em>, and acts with CSS / text / role selectors.
          </p>
          <p className="text-[10px] text-slate-500">
            One browser per workspace; the profile at <span className="font-mono">&lt;cwd&gt;/.browser-profile/</span>{' '}
            keeps cookies and logins between runs. Screenshots land in{' '}
            <span className="font-mono">&lt;cwd&gt;/browser-screenshots/</span>.
          </p>
        </div>

        <SchemaForm
          schema={browserToolConfigSchema}
          value={data.toolSettings?.browser ?? DEFAULT_BROWSER_SETTINGS}
          onChange={updateBrowser}
          fieldOverrides={{
            screenshotQuality: {
              hidden: (data.toolSettings?.browser?.screenshotFormat ?? 'jpeg') === 'png',
            },
          }}
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

        <SchemaForm
          schema={textToSpeechToolConfigSchema}
          value={tts}
          onChange={updateTextToSpeech}
        />
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

        <SchemaForm
          schema={musicGenerateToolConfigSchema}
          value={music}
          onChange={updateMusicGenerate}
        />
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
        <SchemaForm
          schema={subAgentsToolConfigSchema}
          value={{ subAgentSpawning: data.subAgentSpawning, maxSubAgents: data.maxSubAgents }}
          onChange={(patch) => update(nodeId, patch)}
          fieldOverrides={{
            maxSubAgents: { hidden: !data.subAgentSpawning },
          }}
        />
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
          <div className="space-y-2">
            {groupedToolEntries.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="text-[9px] uppercase tracking-wide text-slate-500">
                  {group.label}
                </div>
                {group.entries.map((entry) => {
                  const tool = entry.name;
                  const isHitl = HITL_TOOLS.has(tool);
                  const locked = isHitl && !allowDisableHitl;
                  // Alias-aware "is this tool enabled" check: a saved
                  // `enabledTools` list may still contain a legacy alias
                  // (e.g. `bash`) from before aliases were hidden from the
                  // picker. Treat any alias of `tool` as the same tick.
                  const isChecked = data.enabledTools.some(
                    (saved) => saved === tool || canonicalizeToolName(saved) === tool,
                  );
                  const tooltip = locked
                    ? 'Locked by Safety settings — enable Dangerous Fully Auto to uncheck.'
                    : entry.description || undefined;
                  return (
                    <label
                      key={tool}
                      className={`flex items-center gap-2 ${locked ? 'cursor-not-allowed' : ''}`}
                      title={tooltip}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTool(tool)}
                        disabled={locked}
                        className={`rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30 ${
                          locked ? 'opacity-70' : ''
                        }`}
                      />
                      <span className={`text-xs ${locked ? 'text-slate-400' : 'text-slate-300'}`}>
                        {entry.label || tool}
                        {isHitl && (
                          <span className="ml-1 text-[9px] text-amber-400/80">(safety)</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
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
            icon={<Chrome size={14} />}
            label="browser"
            hint={data.toolSettings?.browser?.autoScreenshot ? 'streaming' : undefined}
            onClick={() => setPage('browser')}
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
