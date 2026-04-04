import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import type { SystemPromptSection } from '../../shared/agent-config';
import { useGraphStore } from '../store/graph-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

interface Props {
  agentNodeId: string;
  onClose: () => void;
}

function SectionRow({ section, expanded, onToggle }: {
  section: SystemPromptSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-slate-800 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-800/40 transition"
      >
        <div className="flex items-center gap-2">
          {expanded
            ? <ChevronDown size={12} className="text-slate-500" />
            : <ChevronRight size={12} className="text-slate-500" />
          }
          <span className="text-xs text-slate-300">{section.label}</span>
        </div>
        <span className="text-[10px] text-slate-600">
          ~{section.tokenEstimate.toLocaleString()} tokens
        </span>
      </button>
      {expanded && (
        <pre className="mx-3 mb-2 max-h-60 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-400 whitespace-pre-wrap">
          {section.content}
        </pre>
      )}
    </div>
  );
}

export default function SystemPromptPreview({ agentNodeId, onClose }: Props) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const safetyGuardrails = useSettingsStore((s) => s.agentDefaults.safetyGuardrails);

  const config = useMemo(
    () => resolveAgentConfig(agentNodeId, nodes, edges, { safetyGuardrails }),
    [agentNodeId, nodes, edges, safetyGuardrails],
  );

  const sections = config?.systemPrompt.sections ?? [];
  const totalTokens = sections.reduce((sum, s) => sum + s.tokenEstimate, 0);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const allExpanded = expandedKeys.size === sections.length;

  const toggleSection = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(sections.map((s) => s.key)));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="text-sm font-medium text-slate-200">System Prompt Preview</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition"
            title={allExpanded ? 'Collapse all' : 'Expand all'}
          >
            {allExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {sections.map((section) => (
          <SectionRow
            key={section.key}
            section={section}
            expanded={expandedKeys.has(section.key)}
            onToggle={() => toggleSection(section.key)}
          />
        ))}
      </div>

      <div className="border-t border-slate-800 px-3 py-2 text-right">
        <span className="text-[10px] text-slate-500">
          Total: ~{totalTokens.toLocaleString()} tokens ({sections.length} sections)
        </span>
      </div>
    </div>
  );
}
