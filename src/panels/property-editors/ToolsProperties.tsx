import { useState } from 'react';
import { ChevronLeft, ChevronRight, Terminal, Code2, Users } from 'lucide-react';
import { useGraphStore } from '../../store/graph-store';
import type { ToolsNodeData, ToolProfile, ToolGroup } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';
import { ALL_TOOL_NAMES, TOOL_GROUPS, TOOL_PROFILES } from '../../../shared/resolve-tool-names';

const PROFILES: ToolProfile[] = ['full', 'coding', 'messaging', 'minimal', 'custom'];
const GROUPS: ToolGroup[] = ['runtime', 'fs', 'web', 'memory', 'coding', 'communication'];

type Page = 'main' | 'exec' | 'code_execution' | 'sub_agents';

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
  const [page, setPage] = useState<Page>('main');
  const [customTool, setCustomTool] = useState('');

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

  // -------------------------------------------------------------------------
  // Page: exec settings
  // -------------------------------------------------------------------------
  if (page === 'exec') {
    return (
      <div className="space-y-1">
        <PageHeader title="exec / bash" onBack={() => setPage('main')} />

        <Field label="Working directory (cwd)">
          <input
            className={inputClass}
            value={data.toolSettings?.exec?.cwd ?? ''}
            onChange={(e) => updateExec({ cwd: e.target.value })}
            placeholder="Empty = server working directory"
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Absolute path where shell commands run. Leave empty for server default.
          </p>
        </Field>

        <Field label="Sandbox">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.toolSettings?.exec?.sandboxWorkdir ?? false}
              onChange={(e) => updateExec({ sandboxWorkdir: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
            />
            <span className="text-xs text-slate-300">Restrict workdir to cwd</span>
          </label>
          <p className="mt-0.5 text-[9px] text-slate-600">
            When enabled, the agent cannot set workdir outside of the configured cwd.
          </p>
        </Field>

        <Field label="Skill">
          <textarea
            className={textareaClass}
            rows={4}
            value={data.toolSettings?.exec?.skill ?? ''}
            onChange={(e) => updateExec({ skill: e.target.value })}
            placeholder="Markdown guidance for how the agent should use exec..."
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Injected into the system prompt to guide exec usage.
          </p>
        </Field>
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

        <Field label="xAI API Key">
          <input
            className={inputClass}
            type="password"
            value={data.toolSettings?.codeExecution?.apiKey ?? ''}
            onChange={(e) => updateCodeExecution({ apiKey: e.target.value })}
            placeholder="Empty = reads XAI_API_KEY from env"
          />
        </Field>

        <Field label="Model">
          <input
            className={inputClass}
            value={data.toolSettings?.codeExecution?.model ?? ''}
            onChange={(e) => updateCodeExecution({ model: e.target.value })}
            placeholder="grok-4-1-fast (default)"
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Runs sandboxed Python on xAI. For calculations, statistics, data analysis.
          </p>
        </Field>

        <Field label="Skill">
          <textarea
            className={textareaClass}
            rows={4}
            value={data.toolSettings?.codeExecution?.skill ?? ''}
            onChange={(e) => updateCodeExecution({ skill: e.target.value })}
            placeholder="Markdown guidance for how the agent should use code_execution..."
          />
          <p className="mt-0.5 text-[9px] text-slate-600">
            Injected into the system prompt to guide code_execution usage.
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
          <div className="space-y-1">
            {ALL_TOOL_NAMES.map((tool) => (
              <label key={tool} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.enabledTools.includes(tool)}
                  onChange={() => toggleTool(tool)}
                  className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500/30"
                />
                <span className="text-xs text-slate-300">{tool}</span>
              </label>
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
