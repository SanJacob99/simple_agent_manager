import type { StructuredError } from './run-types';

export const RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic';

export interface RunErrorDiagnosticData {
  kind: 'run_error';
  runId: string;
  sessionId: string;
  code: StructuredError['code'];
  message: string;
  phase: 'pending' | 'running';
  retriable: boolean;
  createdAt: number;
}

export interface EmptyReplyDiagnosticData {
  kind: 'empty_reply';
  runId: string;
  sessionId: string;
  provider: string;
  modelId: string;
  /** The error message returned by the provider API, if any. */
  apiError?: string;
  createdAt: number;
}

export type RunDiagnosticData = RunErrorDiagnosticData | EmptyReplyDiagnosticData;

export function isRunDiagnosticData(value: unknown): value is RunDiagnosticData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.runId !== 'string' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.createdAt !== 'number'
  ) {
    return false;
  }

  if (candidate.kind === 'run_error') {
    return (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string' &&
      (candidate.phase === 'pending' || candidate.phase === 'running') &&
      typeof candidate.retriable === 'boolean'
    );
  }

  if (candidate.kind === 'empty_reply') {
    return (
      typeof candidate.provider === 'string' &&
      typeof candidate.modelId === 'string'
    );
  }

  return false;
}

export function formatRunDiagnostic(data: RunDiagnosticData): string {
  if (data.kind === 'empty_reply') {
    if (data.apiError) {
      return [
        '**No reply received from the model.**',
        '',
        `The provider (\`${data.provider}\`) returned an error for \`${data.modelId}\`:`,
        '',
        `> ${data.apiError}`,
      ].join('\n');
    }
    return [
      '**No reply received from the model.**',
      '',
      `The provider (\`${data.provider}\`) returned a successful response for \`${data.modelId}\` but streamed no content.`,
      'This often happens with congested free-tier models. Try again or switch to a different model.',
    ].join('\n');
  }
  return `Diagnostic (${data.phase}/${data.code}): ${data.message}`;
}

export const SUB_AGENT_RESUME_CUSTOM_TYPE = 'sam.sub_agent_resume';

export interface SubAgentResumeResult {
  subAgentId: string;
  targetAgentId: string;
  sessionKey: string;
  status: 'completed' | 'error' | 'running';
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  text?: string;
  error?: string;
}

export interface SubAgentResumeData {
  generatedFromRunId: string;
  reason: 'all-complete' | 'timeout';
  generatedAt: number;
  results: SubAgentResumeResult[];
}

export const SUB_AGENT_SPAWN_CUSTOM_TYPE = 'sam.sub_agent_spawn';

/**
 * Persisted on the parent's transcript at spawn time. Immutable audit record;
 * the registry's mutable status (sealed, killed) is in the
 * sub-session's SessionStoreEntry.subAgentMeta.
 */
export interface SubAgentSpawnData {
  subAgentId: string;
  subAgentName: string;
  subSessionKey: string;
  parentRunId: string;
  message: string;             // initial spawn message text
  appliedOverrides: Record<string, unknown>;
  modelId: string;
  providerPluginId: string;
  spawnedAt: number;
}
