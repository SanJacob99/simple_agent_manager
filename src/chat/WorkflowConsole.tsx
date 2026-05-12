import { useEffect, useState } from 'react';
import { Activity, FileText, Pause, Play, Square, X } from 'lucide-react';
import { useCoordinationStore } from '../store/coordination-store';
import type { CoordinationEvent, WorkflowSummary } from '../../shared/coordination-types';

interface WorkflowConsoleProps {
  managerAgentId: string;
}

function formatCounts(summary: WorkflowSummary): string {
  const counts = summary.taskCounts;
  return `${counts.completed} done / ${counts.running} running / ${counts.blocked} blocked`;
}

function statusTone(status: string): string {
  if (status === 'running') return 'text-emerald-300';
  if (status === 'paused' || status === 'needs_human_input') return 'text-amber-300';
  if (status.startsWith('stopped') || status === 'failed' || status === 'cancelled') return 'text-red-300';
  return 'text-slate-300';
}

function TraceModal({
  workflowTitle,
  events,
  onClose,
}: {
  workflowTitle: string;
  events: CoordinationEvent[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-xs font-semibold text-slate-200">
            Trace - {workflowTitle}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {events.length === 0 ? (
            <p className="text-[11px] italic text-slate-500">No events yet.</p>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="border-l border-slate-700 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-300">{event.type}</span>
                    <span className="text-[9px] text-slate-600">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] leading-relaxed text-slate-500">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowConsole({ managerAgentId }: WorkflowConsoleProps) {
  const workflows = useCoordinationStore((s) => s.workflows);
  const traces = useCoordinationStore((s) => s.traces);
  const loading = useCoordinationStore((s) => s.loading);
  const error = useCoordinationStore((s) => s.error);
  const loadDashboard = useCoordinationStore((s) => s.loadDashboard);
  const pauseWorkflow = useCoordinationStore((s) => s.pauseWorkflow);
  const resumeWorkflow = useCoordinationStore((s) => s.resumeWorkflow);
  const stopWorkflow = useCoordinationStore((s) => s.stopWorkflow);
  const requestReport = useCoordinationStore((s) => s.requestReport);
  const loadTrace = useCoordinationStore((s) => s.loadTrace);
  const [traceWorkflowId, setTraceWorkflowId] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
    // TODO(coordination-events): replace polling with coordination events over
    // the existing WebSocket stream once the control plane publishes them.
    const timer = setInterval(() => {
      void loadDashboard();
    }, 2000);
    return () => clearInterval(timer);
  }, [loadDashboard]);

  const visibleWorkflows = workflows.filter((summary) =>
    !['completed', 'cancelled'].includes(summary.workflow.status),
  );
  const traceWorkflow = traceWorkflowId
    ? workflows.find((summary) => summary.workflow.id === traceWorkflowId)
    : null;

  return (
    <>
      <div className="border-t border-slate-800/50 px-4 py-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity size={11} className="text-slate-500" />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
              Workflows
            </span>
          </div>
          {loading && <span className="text-[9px] text-slate-600">syncing</span>}
        </div>

        {error && (
          <div className="mb-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
            {error}
          </div>
        )}

        {visibleWorkflows.length === 0 ? (
          <p className="px-1 text-[10px] italic text-slate-600">No active workflows.</p>
        ) : (
          <div className="max-h-44 space-y-1 overflow-auto pr-1">
            {visibleWorkflows.map((summary) => {
              const workflow = summary.workflow;
              const canPause = workflow.status === 'running';
              const canResume = workflow.status === 'paused' || workflow.status === 'needs_human_input';
              return (
                <div key={workflow.id} className="rounded-md border border-slate-800 bg-slate-950/40 px-2 py-1.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-semibold text-slate-200" title={workflow.title}>
                        {workflow.title}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={`text-[9px] ${statusTone(workflow.status)}`}>
                          {workflow.status}
                        </span>
                        <span className="text-[9px] text-slate-600">{formatCounts(summary)}</span>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-0.5">
                      <button
                        disabled={!canPause}
                        onClick={() => void pauseWorkflow(managerAgentId, workflow.id)}
                        className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-amber-300 disabled:opacity-30"
                        title="Pause"
                      >
                        <Pause size={11} />
                      </button>
                      <button
                        disabled={!canResume}
                        onClick={() => void resumeWorkflow(managerAgentId, workflow.id)}
                        className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-emerald-300 disabled:opacity-30"
                        title="Resume"
                      >
                        <Play size={11} />
                      </button>
                      <button
                        onClick={() => void stopWorkflow(managerAgentId, workflow.id)}
                        className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-red-300"
                        title="Stop"
                      >
                        <Square size={11} />
                      </button>
                      <button
                        onClick={() => void requestReport(managerAgentId, workflow.id)}
                        className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-blue-300"
                        title="Report"
                      >
                        <FileText size={11} />
                      </button>
                      <button
                        onClick={() => {
                          setTraceWorkflowId(workflow.id);
                          void loadTrace(workflow.id);
                        }}
                        className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
                        title="Trace"
                      >
                        <Activity size={11} />
                      </button>
                    </div>
                  </div>
                  {summary.blockedTasks.length > 0 && (
                    <div className="mt-1 truncate text-[9px] text-amber-300">
                      Blocked: {summary.blockedTasks.map((task) => task.title).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {traceWorkflow && (
        <TraceModal
          workflowTitle={traceWorkflow.workflow.title}
          events={traces[traceWorkflow.workflow.id] ?? []}
          onClose={() => setTraceWorkflowId(null)}
        />
      )}
    </>
  );
}
