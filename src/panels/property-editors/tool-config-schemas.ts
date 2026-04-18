/**
 * Schema declarations for per-tool configuration UI.
 *
 * Each schema targets one slot on `ToolSettings` and feeds `SchemaForm` so
 * the old hand-written per-tool page in `ToolsProperties.tsx` can be
 * replaced by a declarative render. Kept client-side for now; the same
 * structure will consume server-authored schemas from
 * `ToolModule.config.schema` once that is wired through an API endpoint.
 */

import type { ObjectSchema } from './schema-form/types';
import type {
  CanvaToolSettings,
  CodeExecutionToolSettings,
  ExecToolSettings,
  WebSearchToolSettings,
} from '../../types/nodes';

export const execToolConfigSchema: ObjectSchema<ExecToolSettings> = {
  type: 'object',
  properties: {
    cwd: {
      type: 'string',
      title: 'Working directory override',
      placeholder: 'Inherited from agent node',
      description: "Leave empty to use the agent node's working directory.",
    },
    sandboxWorkdir: {
      type: 'boolean',
      title: 'Sandbox',
      checkboxLabel: 'Restrict workdir to cwd',
      description: 'When enabled, the agent cannot set workdir outside of the configured cwd.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use exec...',
      description: 'Injected into the system prompt to guide exec usage.',
    },
  },
};

export const codeExecutionToolConfigSchema: ObjectSchema<CodeExecutionToolSettings> = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      format: 'password',
      title: 'xAI API Key',
      placeholder: 'Empty = reads XAI_API_KEY from env',
    },
    model: {
      type: 'string',
      title: 'Model',
      placeholder: 'grok-4-1-fast (default)',
      description: 'Runs sandboxed Python on xAI. For calculations, statistics, data analysis.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use code_execution...',
      description: 'Injected into the system prompt to guide code_execution usage.',
    },
  },
};

export const webSearchToolConfigSchema: ObjectSchema<WebSearchToolSettings> = {
  type: 'object',
  properties: {
    tavilyApiKey: {
      type: 'string',
      format: 'password',
      title: 'Tavily API Key',
      placeholder: 'Empty = TAVILY_API_KEY env or DuckDuckGo fallback',
      description:
        'With a Tavily key: AI-summarized results (free tier: 500/month). Without: basic DuckDuckGo HTML scrape.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use web_search...',
      description: 'Injected into the system prompt to guide web_search usage.',
    },
  },
};

export const canvaToolConfigSchema: ObjectSchema<CanvaToolSettings> = {
  type: 'object',
  properties: {
    portRangeStart: {
      type: 'integer',
      title: 'Port range start',
      minimum: 1024,
      maximum: 65535,
    },
    portRangeEnd: {
      type: 'integer',
      title: 'Port range end',
      minimum: 1024,
      maximum: 65535,
      description: 'The agent auto-picks a free port in this range. It may also request a specific port.',
    },
    skill: {
      type: 'string',
      format: 'textarea',
      title: 'Skill',
      placeholder: 'Markdown guidance for how the agent should use canva...',
      description: 'Injected into the system prompt to guide canva usage.',
    },
  },
};
