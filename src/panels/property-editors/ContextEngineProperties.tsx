import { useGraphStore } from '../../store/graph-store';
import type { ContextEngineNodeData, CompactionStrategy } from '../../types/nodes';
import { Field, Tooltip, inputClass, selectClass, textareaClass } from './shared';

const COMPACTION_STRATEGIES: CompactionStrategy[] = ['summary', 'sliding-window', 'trim-oldest', 'hybrid'];
const COMPACTION_TRIGGERS = ['auto', 'manual', 'threshold'] as const;

import { useContextEngineSync } from '../../nodes/useContextEngineSync';

interface Props {
  nodeId: string;
  data: ContextEngineNodeData;
}

export default function ContextEngineProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const { connectedAgent, modelId, modelContextWindow } = useContextEngineSync(nodeId, data);

  // --- System prompt additions ---

  const addSystemPromptAddition = () => {
    update(nodeId, {
      systemPromptAdditions: [...data.systemPromptAdditions, ''],
    });
  };

  const updateAddition = (index: number, value: string) => {
    const updated = [...data.systemPromptAdditions];
    updated[index] = value;
    update(nodeId, { systemPromptAdditions: updated });
  };

  const removeAddition = (index: number) => {
    update(nodeId, {
      systemPromptAdditions: data.systemPromptAdditions.filter((_, i) => i !== index),
    });
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

      {/* Token Budget — inherited from model */}
      <Field label="Token Budget">
        {modelContextWindow ? (
          <>
            <div className={`${inputClass} flex items-center justify-between bg-slate-800/60 cursor-default`}>
              <span>{data.tokenBudget.toLocaleString()}</span>
              <span className="text-[9px] text-blue-400 font-medium">inherited</span>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-600">
              From {modelId} ({modelContextWindow.toLocaleString()} tokens)
            </p>
          </>
        ) : connectedAgent ? (
          <>
            <input
              className={inputClass}
              type="number"
              min={1024}
              step={1024}
              value={data.tokenBudget}
              onChange={(e) =>
                update(nodeId, { tokenBudget: parseInt(e.target.value) || 128000 })
              }
            />
            <p className="mt-0.5 text-[10px] text-amber-500/80">
              Model metadata unavailable — set manually
            </p>
          </>
        ) : (
          <>
            <input
              className={inputClass}
              type="number"
              min={1024}
              step={1024}
              value={data.tokenBudget}
              onChange={(e) =>
                update(nodeId, { tokenBudget: parseInt(e.target.value) || 128000 })
              }
            />
            <p className="mt-0.5 text-[10px] text-slate-600">
              Connect to an agent to inherit from model
            </p>
          </>
        )}
      </Field>

      <Field label="Reserved for Response">
        <input
          className={inputClass}
          type="number"
          min={256}
          step={256}
          value={data.reservedForResponse}
          onChange={(e) =>
            update(nodeId, { reservedForResponse: parseInt(e.target.value) || 4096 })
          }
        />
      </Field>

      {/* Compaction */}
      <Field label="Compaction Strategy">
        <select
          className={selectClass}
          value={data.compactionStrategy}
          onChange={(e) =>
            update(nodeId, { compactionStrategy: e.target.value as CompactionStrategy })
          }
        >
          {COMPACTION_STRATEGIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>

      <Field label="Compaction Trigger">
        <select
          className={selectClass}
          value={data.compactionTrigger}
          onChange={(e) => update(nodeId, { compactionTrigger: e.target.value })}
        >
          {COMPACTION_TRIGGERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>

      {/* Threshold input — depends on trigger type */}
      {data.compactionTrigger === 'threshold' && (
        <Field label="Compaction Threshold (0-1)">
          <input
            className={inputClass}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={data.compactionThreshold}
            onChange={(e) =>
              update(nodeId, { compactionThreshold: parseFloat(e.target.value) || 0.8 })
            }
          />
          <p className="mt-0.5 text-[10px] text-slate-600">
            Ratio of token budget usage that triggers compaction
          </p>
        </Field>
      )}

      {data.compactionTrigger === 'manual' && (
        <Field label="Compaction Token Limit">
          <input
            className={inputClass}
            type="number"
            min={0}
            step={1024}
            value={data.compactionThreshold}
            onChange={(e) =>
              update(nodeId, { compactionThreshold: parseFloat(e.target.value) || 0 })
            }
          />
          <p className="mt-0.5 text-[10px] text-slate-600">
            Number of tokens after which to compact when triggered
          </p>
        </Field>
      )}

      {data.compactionTrigger === 'auto' && (
        <p className="mb-3 text-[10px] text-slate-600 italic">
          Compaction runs automatically when the context window reaches 80% capacity.
        </p>
      )}

      <Field label="Owns Compaction">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.ownsCompaction}
            onChange={(e) => update(nodeId, { ownsCompaction: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <Tooltip text="When enabled, the Context Engine takes full control of compaction. No other node (e.g. Memory) will trigger its own compaction — all history trimming and summarization is managed here.">
            <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
              Engine controls all compaction
            </span>
          </Tooltip>
        </label>
      </Field>

      <Field label="Auto-Flush Before Compact">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.autoFlushBeforeCompact}
            onChange={(e) => update(nodeId, { autoFlushBeforeCompact: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <Tooltip text="Before compaction starts, all pending tool results and buffered messages are flushed into the conversation. This ensures no in-flight data is lost when history is trimmed or summarized.">
            <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
              Flush pending writes before compacting
            </span>
          </Tooltip>
        </label>
      </Field>

      {/* RAG */}
      <Field label="RAG Integration">
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.ragEnabled}
              onChange={(e) => update(nodeId, { ragEnabled: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
            />
            <Tooltip text="Retrieval-Augmented Generation injects relevant document chunks into the context before each prompt. Requires a connected Vector Database node to search against.">
              <span className="text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
                Enable RAG retrieval
              </span>
            </Tooltip>
          </label>
          {data.ragEnabled && (
            <>
              <div>
                <label className="text-[10px] text-slate-500">Top K results</label>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={50}
                  value={data.ragTopK}
                  onChange={(e) =>
                    update(nodeId, { ragTopK: parseInt(e.target.value) || 5 })
                  }
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Min similarity score</label>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={data.ragMinScore}
                  onChange={(e) =>
                    update(nodeId, { ragMinScore: parseFloat(e.target.value) || 0.7 })
                  }
                />
              </div>
            </>
          )}
        </div>
      </Field>

      {/* System Prompt Additions */}
      <Field label="System Prompt Additions">
        <Tooltip text="Additional text injected into the system prompt at runtime. Use this to add dynamic instructions, persona details, or context-specific rules that augment the agent's base system prompt.">
          <span className="mb-1.5 inline-block text-[10px] text-slate-500 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help">
            What are these?
          </span>
        </Tooltip>
        <div className="space-y-2">
          {data.systemPromptAdditions.map((addition, i) => (
            <div key={i} className="flex gap-1.5">
              <textarea
                className={textareaClass + ' flex-1'}
                rows={2}
                value={addition}
                onChange={(e) => updateAddition(i, e.target.value)}
                placeholder="Dynamic text to prepend to system prompt..."
              />
              <button
                onClick={() => removeAddition(i)}
                className="self-start text-xs text-red-400 hover:text-red-300"
              >
                X
              </button>
            </div>
          ))}
          <button
            onClick={addSystemPromptAddition}
            className="w-full rounded-md border border-dashed border-slate-700 py-1.5 text-xs text-slate-500 transition hover:border-slate-500 hover:text-slate-300"
          >
            + Add system prompt addition
          </button>
        </div>
      </Field>
    </div>
  );
}
