import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const XAI_RESPONSES_ENDPOINT = 'https://api.x.ai/v1/responses';
const DEFAULT_MODEL = 'grok-4-1-fast';
const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 120;

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

// ---------------------------------------------------------------------------
// xAI Responses API types
// ---------------------------------------------------------------------------

interface XaiAnnotation {
  type?: string;
  url?: string;
}

interface XaiContentBlock {
  type?: string;
  text?: string;
  annotations?: XaiAnnotation[];
}

interface XaiOutputEntry {
  type?: string;
  content?: XaiContentBlock[];
  text?: string;
  annotations?: XaiAnnotation[];
}

interface XaiResponseBody {
  output?: XaiOutputEntry[];
  output_text?: string;
  citations?: string[];
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function extractResponseContent(data: XaiResponseBody): {
  text: string;
  citations: string[];
  usedCodeExecution: boolean;
} {
  // Collect output types to check if code_interpreter was actually invoked
  const outputTypes = new Set<string>();
  if (Array.isArray(data.output)) {
    for (const entry of data.output) {
      if (entry.type) outputTypes.add(entry.type);
    }
  }

  // Extract text content from the response
  for (const output of data.output ?? []) {
    // Message wrapper → look inside content blocks
    if (output.type === 'message' && Array.isArray(output.content)) {
      for (const block of output.content) {
        if (block.type === 'output_text' && typeof block.text === 'string' && block.text) {
          const urls = (block.annotations ?? [])
            .filter((a) => a.type === 'url_citation' && typeof a.url === 'string')
            .map((a) => a.url!);
          return {
            text: block.text,
            citations: [...new Set(urls)],
            usedCodeExecution: outputTypes.has('code_interpreter_call'),
          };
        }
      }
    }
    // Top-level output_text block
    if (output.type === 'output_text' && typeof output.text === 'string' && output.text) {
      const urls = (output.annotations ?? [])
        .filter((a) => a.type === 'url_citation' && typeof a.url === 'string')
        .map((a) => a.url!);
      return {
        text: output.text,
        citations: [...new Set(urls)],
        usedCodeExecution: outputTypes.has('code_interpreter_call'),
      };
    }
  }

  return {
    text: typeof data.output_text === 'string' ? data.output_text : 'No response',
    citations: Array.isArray(data.citations) ? data.citations : [],
    usedCodeExecution: outputTypes.has('code_interpreter_call'),
  };
}

// ---------------------------------------------------------------------------
// Tool context & factory
// ---------------------------------------------------------------------------

export interface CodeExecutionToolContext {
  /** xAI API key. Required — tool throws if missing at call time. */
  apiKey: string;
  /** Model to use (defaults to grok-4-1-fast) */
  model?: string;
  /** Timeout in seconds (defaults to 30, max 120) */
  timeoutSeconds?: number;
}

export function createCodeExecutionTool(ctx: CodeExecutionToolContext): AgentTool<TSchema> {
  const model = ctx.model || DEFAULT_MODEL;
  const timeoutSec = Math.min(
    Math.max(1, ctx.timeoutSeconds ?? DEFAULT_TIMEOUT_SEC),
    MAX_TIMEOUT_SEC,
  );

  return {
    name: 'code_execution',
    description:
      'Run sandboxed Python analysis via xAI remote sandbox. ' +
      'Use for calculations, tabulation, statistics, chart-style analysis, and processing data. ' +
      'Do NOT use for local files, shell commands, or repo access — use exec for that. ' +
      'Include any data to analyze directly in the task.',
    label: 'Code Execution',
    parameters: Type.Object({
      task: Type.String({
        description:
          'The full analysis task for the remote Python sandbox. Include any data to analyze directly in the task.',
      }),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      const task = params.task as string;
      if (!task || !task.trim()) {
        throw new Error('No task provided');
      }

      if (!ctx.apiKey) {
        throw new Error(
          'code_execution requires an xAI API key. Set XAI_API_KEY in the environment or configure it in tool settings.',
        );
      }

      const startedAt = Date.now();
      const controller = new AbortController();

      // Forward parent abort signal
      if (signal) {
        if (signal.aborted) throw new Error('Aborted');
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      // Timeout
      const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

      try {
        const response = await fetch(XAI_RESPONSES_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ctx.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: [{ role: 'user', content: task }],
            tools: [{ type: 'code_interpreter' }],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`xAI API error ${response.status}: ${body.slice(0, 500)}`);
        }

        const data = (await response.json()) as XaiResponseBody;
        const result = extractResponseContent(data);
        const tookMs = Date.now() - startedAt;

        const parts: string[] = [];
        parts.push(result.text);
        if (result.citations.length > 0) {
          parts.push('');
          parts.push('Citations:');
          for (const url of result.citations) {
            parts.push(`  ${url}`);
          }
        }
        parts.push('');
        parts.push(
          `[${result.usedCodeExecution ? 'executed Python' : 'text-only response'}` +
            ` | model: ${model} | ${tookMs}ms]`,
        );

        return textResult(parts.join('\n'));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
