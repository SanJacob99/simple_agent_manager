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
