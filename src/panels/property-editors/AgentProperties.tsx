import { useGraphStore } from '../../store/graph-store';
import type { AgentNodeData, ThinkingLevel } from '../../types/nodes';
import { Field, inputClass, selectClass, textareaClass } from './shared';

const PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'ollama',
  'mistral',
  'groq',
  'xai',
];

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini'],
  openrouter: [
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-haiku-4-5-20251001',
    'openai/gpt-4o',
    'openai/o3-mini',
    'google/gemini-2.0-flash',
    'meta-llama/llama-3.1-70b-instruct',
    'mistralai/mistral-large',
    'deepseek/deepseek-chat-v3',
  ],
  google: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
  ollama: ['llama3.1', 'mistral', 'codellama', 'mixtral'],
  mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
  groq: ['llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
  xai: ['grok-2', 'grok-2-mini'],
};

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

interface Props {
  nodeId: string;
  data: AgentNodeData;
}

export default function AgentProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  return (
    <div className="space-y-1">
      <Field label="Agent Name">
        <input
          className={inputClass}
          value={data.name}
          onChange={(e) => update(nodeId, { name: e.target.value })}
          placeholder="My Agent"
        />
      </Field>

      <Field label="Description">
        <input
          className={inputClass}
          value={data.description || ''}
          onChange={(e) => update(nodeId, { description: e.target.value })}
          placeholder="What does this agent do?"
        />
      </Field>

      <Field label="Tags">
        <input
          className={inputClass}
          value={(data.tags || []).join(', ')}
          onChange={(e) =>
            update(nodeId, {
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="tag1, tag2, ..."
        />
      </Field>

      <Field label="Provider">
        <select
          className={selectClass}
          value={data.provider}
          onChange={(e) => {
            const provider = e.target.value;
            const models = MODELS[provider] || [];
            update(nodeId, { provider, modelId: models[0] || '' });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model">
        <select
          className={selectClass}
          value={data.modelId}
          onChange={(e) => update(nodeId, { modelId: e.target.value })}
        >
          {(MODELS[data.provider] || []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Thinking Level">
        <select
          className={selectClass}
          value={data.thinkingLevel}
          onChange={(e) =>
            update(nodeId, { thinkingLevel: e.target.value as ThinkingLevel })
          }
        >
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </Field>

      <Field label="System Prompt">
        <textarea
          className={textareaClass}
          rows={6}
          value={data.systemPrompt}
          onChange={(e) => update(nodeId, { systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant..."
        />
      </Field>
    </div>
  );
}
