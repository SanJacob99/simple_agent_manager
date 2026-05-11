import { useState } from 'react';
import { useGraphStore } from '../../store/graph-store';
import type {
  GuardrailsNodeData,
  GuardrailPiiCategory,
} from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const PII_CATEGORIES: { id: GuardrailPiiCategory; label: string; hint: string }[] = [
  { id: 'email', label: 'Email addresses', hint: 'foo@example.com' },
  { id: 'ssn', label: 'US Social Security Number', hint: '123-45-6789' },
  { id: 'credit_card', label: 'Credit-card-shaped numbers', hint: '13–19 digit groups' },
];

interface Props {
  nodeId: string;
  data: GuardrailsNodeData;
}

export default function GuardrailsProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);
  const [newTerm, setNewTerm] = useState('');

  const togglePii = (id: GuardrailPiiCategory) => {
    const next = data.piiCategories.includes(id)
      ? data.piiCategories.filter((c) => c !== id)
      : [...data.piiCategories, id];
    update(nodeId, { piiCategories: next });
  };

  const addTerm = () => {
    const value = newTerm.trim();
    if (!value || data.blockedTerms.includes(value)) return;
    update(nodeId, { blockedTerms: [...data.blockedTerms, value] });
    setNewTerm('');
  };

  const removeTerm = (term: string) => {
    update(nodeId, { blockedTerms: data.blockedTerms.filter((t) => t !== term) });
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

      <Field
        label="Enabled"
        tooltip="When off, the guardrail is wired into the graph but the runtime does not enforce its rules."
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
          />
          <span className="text-xs text-slate-300">Enforce at runtime</span>
        </label>
      </Field>

      <Field
        label="Apply to"
        tooltip="Input checks run before the user message reaches the model. Output checks scan the assistant's full reply after each turn."
      >
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.checkInput}
              onChange={(e) => update(nodeId, { checkInput: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
            />
            <span className="text-xs text-slate-300">User input</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.checkOutput}
              onChange={(e) => update(nodeId, { checkOutput: e.target.checked })}
              className="rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
            />
            <span className="text-xs text-slate-300">Assistant output</span>
          </label>
        </div>
      </Field>

      <Field
        label="Action on violation"
        tooltip="Block aborts the run with a structured error. Warn lets the message through and only emits a guardrail:violation event."
      >
        <select
          className={selectClass}
          value={data.action}
          onChange={(e) =>
            update(nodeId, { action: e.target.value as GuardrailsNodeData['action'] })
          }
        >
          <option value="block">Block (refuse)</option>
          <option value="warn">Warn (log only)</option>
        </select>
      </Field>

      <Field
        label="Max input length (chars)"
        tooltip="0 disables the length check."
      >
        <input
          type="number"
          min={0}
          className={inputClass}
          value={data.maxInputChars}
          onChange={(e) =>
            update(nodeId, { maxInputChars: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Field>

      <Field label="PII categories">
        <div className="space-y-1">
          {PII_CATEGORIES.map((cat) => (
            <label key={cat.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={data.piiCategories.includes(cat.id)}
                onChange={() => togglePii(cat.id)}
                className="mt-0.5 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
              />
              <span className="text-xs text-slate-300">
                {cat.label}
                <span className="ml-1 text-[10px] text-slate-500">({cat.hint})</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Blocked terms"
        tooltip="Case-insensitive substring matches. Trigger when present in input or output (depending on Apply to)."
      >
        <div className="flex gap-1.5">
          <input
            className={inputClass}
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="confidential"
            onKeyDown={(e) => e.key === 'Enter' && addTerm()}
          />
          <button
            onClick={addTerm}
            className="shrink-0 rounded-md bg-slate-700 px-2.5 text-xs text-slate-300 transition hover:bg-slate-600"
          >
            Add
          </button>
        </div>
        {data.blockedTerms.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.blockedTerms.map((term) => (
              <span
                key={term}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {term}
                <button
                  type="button"
                  onClick={() => removeTerm(term)}
                  className="text-slate-500 hover:text-red-400"
                  aria-label={`Remove ${term}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Field>

      <Field
        label="Block message"
        tooltip="Returned to the user when a block action fires. Empty falls back to a generic notice."
      >
        <textarea
          className={textareaClass}
          rows={2}
          value={data.blockMessage}
          onChange={(e) => update(nodeId, { blockMessage: e.target.value })}
          placeholder="Sorry, that request can't be processed."
        />
      </Field>
    </div>
  );
}
