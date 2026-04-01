import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { SkillsNodeData } from '../../types/nodes';
import { Field, inputClass } from './shared';

const AVAILABLE_SKILLS = [
  'code_generation',
  'summarization',
  'translation',
  'data_analysis',
  'creative_writing',
  'reasoning',
  'math',
];

interface Props {
  nodeId: string;
  data: SkillsNodeData;
}

export default function SkillsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [customSkill, setCustomSkill] = useState('');

  const toggleSkill = (skill: string) => {
    const skills = data.enabledSkills.includes(skill)
      ? data.enabledSkills.filter((s) => s !== skill)
      : [...data.enabledSkills, skill];
    update(nodeId, { enabledSkills: skills });
  };

  const addCustomSkill = () => {
    if (customSkill.trim() && !data.enabledSkills.includes(customSkill.trim())) {
      update(nodeId, { enabledSkills: [...data.enabledSkills, customSkill.trim()] });
      setCustomSkill('');
    }
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

      <Field label="Available Skills">
        <div className="space-y-1">
          {AVAILABLE_SKILLS.map((skill) => (
            <label key={skill} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={data.enabledSkills.includes(skill)}
                onChange={() => toggleSkill(skill)}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500/30"
              />
              <span className="text-xs text-slate-300">{skill}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Add Custom Skill">
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            value={customSkill}
            onChange={(e) => setCustomSkill(e.target.value)}
            placeholder="skill_name"
            onKeyDown={(e) => e.key === 'Enter' && addCustomSkill()}
          />
          <button
            onClick={addCustomSkill}
            className="shrink-0 rounded-md bg-slate-700 px-2.5 text-xs text-slate-300 transition hover:bg-slate-600"
          >
            Add
          </button>
        </div>
      </Field>
    </div>
  );
}
