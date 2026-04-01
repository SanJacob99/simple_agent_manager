import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type { ToolsNodeData } from '../../types/nodes';
import { Field, inputClass } from './shared';

const AVAILABLE_TOOLS = [
  'read_file',
  'write_file',
  'web_search',
  'bash',
  'code_interpreter',
  'image_generation',
  'text_to_speech',
  'calculator',
];

interface Props {
  nodeId: string;
  data: ToolsNodeData;
}

export default function ToolsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [customTool, setCustomTool] = useState('');

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

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Available Tools">
        <div className="space-y-1">
          {AVAILABLE_TOOLS.map((tool) => (
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
      </Field>

      <Field label="Add Custom Tool">
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            value={customTool}
            onChange={(e) => setCustomTool(e.target.value)}
            placeholder="tool_name"
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
    </div>
  );
}
