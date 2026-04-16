import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import { logError } from '../logger';
import { formatToolParamPreview } from './tool-redact';
import { normalizeToolName } from './tool-name-policy';

export interface ToolErrorDetails {
  status: 'error';
  tool: string;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce tool-call params into a plain object when providers stream arguments
 * as JSON string deltas. Returns the original value when it cannot be parsed
 * into an object — schema validation downstream still rejects bad shapes.
 */
export function coerceParamsRecord(value: unknown): unknown {
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isPlainObject(parsed)) return parsed;
      } catch {
        // fall through — return original value
      }
    }
  }
  return value;
}

function payloadTextResult<T>(details: T): AgentToolResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
  };
}

function buildToolErrorResult(toolName: string, message: string): AgentToolResult<ToolErrorDetails> {
  const details: ToolErrorDetails = {
    status: 'error',
    tool: toolName,
    error: message,
  };
  return payloadTextResult(details);
}

/**
 * Normalize whatever a tool returned into a valid AgentToolResult. Tools
 * should return the canonical shape already, but anything with a missing
 * `content[]` gets coerced so the runtime never forwards a broken payload
 * to the model.
 */
function normalizeToolExecutionResult(
  toolName: string,
  result: unknown,
): AgentToolResult<unknown> {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return result as AgentToolResult<unknown>;
    }
    const details = 'details' in record ? record.details : record;
    return payloadTextResult(details ?? { status: 'ok', tool: toolName });
  }
  return payloadTextResult(result ?? { status: 'ok', tool: toolName });
}

function describeError(err: unknown): { message: string; stack?: string; name: string } {
  if (err instanceof Error) {
    const message = err.message?.trim() ? err.message : String(err);
    return { message, stack: err.stack, name: err.name };
  }
  return { message: String(err), name: '' };
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  if (err && typeof err === 'object' && 'name' in err) {
    return (err as { name?: unknown }).name === 'AbortError';
  }
  return false;
}

/**
 * Wrap a single AgentTool so its execute() is:
 *   - fed coerced params (string JSON → object)
 *   - guarded by a try/catch that re-throws on abort and otherwise returns a
 *     structured error AgentToolResult
 *   - guaranteed to return a well-formed AgentToolResult (content[] + details)
 *
 * The tool's public name and schema are preserved. Adapter logging uses a
 * normalized name purely for the log label.
 */
export function adaptAgentTool(tool: AgentTool<TSchema>): AgentTool<TSchema> {
  const originalExecute = tool.execute;
  const logLabel = normalizeToolName(tool.name || 'tool');

  const execute: AgentTool<TSchema>['execute'] = async (toolCallId, params, signal, onUpdate) => {
    const effectiveParams = coerceParamsRecord(params) as typeof params;
    try {
      const raw = await originalExecute(toolCallId, effectiveParams, signal, onUpdate);
      return normalizeToolExecutionResult(tool.name, raw) as AgentToolResult<any>;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        throw err;
      }
      const described = describeError(err);
      const rawPreview = formatToolParamPreview('raw_params', params);
      const serializedRaw = JSON.stringify(params);
      const serializedEff = JSON.stringify(effectiveParams);
      const effectivePreview =
        serializedRaw !== serializedEff
          ? ' ' + formatToolParamPreview('effective_params', effectiveParams)
          : '';
      logError('tools', `${logLabel} failed: ${described.message} ${rawPreview}${effectivePreview}`);
      if (described.stack && described.stack !== described.message) {
        logError('tools', `${logLabel} stack:\n${described.stack}`);
      }
      return buildToolErrorResult(tool.name, described.message) as AgentToolResult<any>;
    }
  };

  return { ...tool, execute };
}

export function adaptAgentTools(tools: AgentTool<TSchema>[]): AgentTool<TSchema>[] {
  return tools.map(adaptAgentTool);
}

export function isToolErrorDetails(value: unknown): value is ToolErrorDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'error' &&
    typeof (value as { tool?: unknown }).tool === 'string' &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}
