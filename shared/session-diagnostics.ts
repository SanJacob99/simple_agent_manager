import type { StructuredError } from './run-types';

export const RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic';

export interface RunDiagnosticData {
  kind: 'run_error';
  runId: string;
  sessionId: string;
  code: StructuredError['code'];
  message: string;
  phase: 'pending' | 'running';
  retriable: boolean;
  createdAt: number;
}

export function isRunDiagnosticData(value: unknown): value is RunDiagnosticData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'run_error' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    (candidate.phase === 'pending' || candidate.phase === 'running') &&
    typeof candidate.retriable === 'boolean' &&
    typeof candidate.createdAt === 'number'
  );
}

export function formatRunDiagnostic(data: RunDiagnosticData): string {
  return `Diagnostic (${data.phase}/${data.code}): ${data.message}`;
}
