import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { ToolsNodeData, ToolProfile, ToolGroup } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';
import { ALL_TOOL_NAMES, TOOL_GROUPS } from '../../runtime/tool-factory';

const PROFILES: ToolProfile[] = ['full', 'coding', 'messaging', 'minimal', 'custom'];
const GROUPS: ToolGroup[] = ['runtime', 'fs', 'web', 'memory', 'coding', 'communication'];

interface Props {
  nodeId: string;
  data: ToolsNodeData;
}

export default function ToolsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [customTool, setCustomTool] = useState('');
  const [newSkillName, setNewSkillName] = useState('');

  const toggleTool = (tool: string) => {
    const tools = data.enabledTools.includes(tool)
      ? data.enabledTools.filter((t) => t !== tool)
      : [...data.enabledTools, tool];
    update(nodeId, { enabledTools: tools });
  };

  const toggleGroup = (group: ToolGroup) => {
    const groups = data.enabledGroups.includes(group)
      ? data.enabledGroups.filter((g) => g !== group)
      : [...data.enabledGroups, group];
    update(nodeId, { enabledGroups: groups });
  };

  const addCustomTool = () => {
    if (customTool.trim() && !data.enabledTools.includes(customTool.trim())) {
      update(nodeId, { enabledTools: [...data.enabledTools, customTool.trim()] });
      setCustomTool('');
    }
  };

  const addSkill = () => {
    if (!newSkillName.trim()) return;
    const skill = {
      id: `skill_${Date.now()}`,
      name: newSkillName.trim(),
      content: '',
      injectAs: 'system-prompt' as const,
    };
    update(nodeId, { skills: [...data.skills, skill] });
    setNewSkillName('');
  };

  const updateSkill = (id: string, updates: Record<string, unknown>) => {
    update(nodeId, {
      skills: data.skills.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
  };

  const removeSkill = (id: string) => {
    update(nodeId, { skills: data.skills.filter((s) => s.id !== id) });
  };

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
          onChange={(e) => update(nodeId, { profile: e.target.value as ToolProfile })}
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
                checked={data.enabledGroups.includes(group)}
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

      {/* Skills */}
      <Field label="Skills (Markdown Instructions)">
        <div className="space-y-2">
          {data.skills.map((skill) => (
            <div key={skill.id} className="rounded border border-slate-700 p-2">
              <div className="flex items-center justify-between mb-1">
                <input
                  className={inputClass + ' !w-auto flex-1'}
                  value={skill.name}
                  onChange={(e) => updateSkill(skill.id, { name: e.target.value })}
                  placeholder="Skill name"
                />
                <button
                  onClick={() => removeSkill(skill.id)}
                  className="ml-2 text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              <textarea
                className={textareaClass}
                rows={3}
                value={skill.content}
                onChange={(e) => updateSkill(skill.id, { content: e.target.value })}
                placeholder="Markdown instructions for this skill..."
              />
              <select
                className={selectClass + ' mt-1'}
                value={skill.injectAs}
                onChange={(e) => updateSkill(skill.id, { injectAs: e.target.value })}
              >
                <option value="system-prompt">Inject as system prompt</option>
                <option value="user-context">Inject as user context</option>
              </select>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              className={inputClass}
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="New skill name"
              onKeyDown={(e) => e.key === 'Enter' && addSkill()}
            />
            <button
              onClick={addSkill}
              className="shrink-0 rounded-md bg-slate-700 px-2.5 text-xs text-slate-300 transition hover:bg-slate-600"
            >
              Add
            </button>
          </div>
        </div>
      </Field>

      {/* Sub-agent spawning */}
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
        {data.subAgentSpawning && (
          <div className="mt-1">
            <label className="text-[10px] text-slate-500">Max sub-agents</label>
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
          </div>
        )}
      </Field>
    </div>
  );
}
