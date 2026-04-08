import { useState } from 'react';
import testFixture from '../../fixtures/test-graph.json';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { useSessionStore } from '../../store/session-store';
import { resolveAgentConfig } from '../../utils/graph-to-agent';
import { StorageClient } from '../../runtime/storage-client';
import type { MaintenanceReport } from '../../../shared/storage-types';
import {
  downloadJson,
  exportGraph,
  importGraph,
  uploadJson,
} from '../../utils/export-import';
import { useSettingsStore } from '../settings-store';

export default function DataMaintenanceSection() {
  const [message, setMessage] = useState<string | null>(null);
  const [maintenanceReport, setMaintenanceReport] = useState<MaintenanceReport | null>(null);

  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const loadGraph = useGraphStore((state) => state.loadGraph);
  const clearGraph = useGraphStore((state) => state.clearGraph);
  const resetAllSessions = useSessionStore((state) => state.resetAllSessions);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const resetModelCatalog = useModelCatalogStore((state) => state.reset);

  const handleImport = async () => {
    try {
      const data = await uploadJson();
      const result = importGraph(data);
      if (!result) {
        setMessage('Invalid graph file format.');
        return;
      }
      loadGraph(result.nodes, result.edges);
      setMessage('Graph imported.');
    } catch {
      setMessage('Import cancelled.');
    }
  };

  const confirmAndRun = (text: string, fn: () => void) => {
    if (window.confirm(text)) {
      fn();
      setMessage(null);
    }
  };

  const clearPersistedSessions = async () => {
    const agentNodes = nodes.filter((node) => node.data.type === 'agent');
    await Promise.all(agentNodes.map(async (node) => {
      const agentName = (node.data as { name?: string }).name;
      if (!agentName) {
        return;
      }

      const config = resolveAgentConfig(node.id, nodes, edges);
      if (!config?.storage) {
        return;
      }

      const client = new StorageClient(config.storage, agentName, node.id);
      await client.init();
      await client.deleteAllSessions();
    }));
  };

  const runMaintenance = async () => {
    setMaintenanceReport(null);
    const agentNodes = nodes.filter((node) => node.data.type === 'agent');
    for (const node of agentNodes) {
      const agentName = (node.data as { name?: string }).name;
      if (!agentName) continue;

      const config = resolveAgentConfig(node.id, nodes, edges);
      if (!config?.storage) continue;

      const client = new StorageClient(config.storage, agentName, node.id);
      const report = await client.runMaintenance();
      setMaintenanceReport(report);
    }
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            downloadJson(exportGraph(nodes, edges), `agent-graph-${Date.now()}.json`)
          }
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60"
        >
          Export Graph
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60"
        >
          Import Graph
        </button>
        <button
          type="button"
          onClick={() => {
            const result = importGraph(testFixture);
            if (result) {
              loadGraph(result.nodes, result.edges);
              setMessage('Test fixture loaded.');
            }
          }}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60 sm:col-span-2"
        >
          Load Test Fixture
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            confirmAndRun('Clear the current graph?', () => clearGraph())
          }
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15"
        >
          Clear Graph
        </button>
        <button
          type="button"
          onClick={() =>
            confirmAndRun('Clear all chat sessions?', () => {
              void clearPersistedSessions()
                .catch(console.error)
                .finally(() => resetAllSessions());
            })
          }
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15"
        >
          Clear Chat Sessions
        </button>
        <button
          type="button"
          onClick={() =>
            confirmAndRun('Reset API keys and agent defaults?', () => {
              resetSettings();
              resetModelCatalog();
            })
          }
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15"
        >
          Clear App Settings
        </button>
        <button
          type="button"
          onClick={() =>
            confirmAndRun(
              'Reset graph, sessions, settings, and model catalog?',
              () => {
                void clearPersistedSessions()
                  .catch(console.error)
                  .finally(() => {
                    clearGraph();
                    resetAllSessions();
                    resetSettings();
                    resetModelCatalog();
                  });
              },
            )
          }
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:border-red-400/60 hover:bg-red-500/15"
        >
          Reset Everything
        </button>
        <button
          type="button"
          onClick={() => void runMaintenance()}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60 sm:col-span-2"
        >
          Run Maintenance
        </button>
      </div>

      {maintenanceReport && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-1">
          <div>Mode: {maintenanceReport.mode}</div>
          <div>Pruned entries: {maintenanceReport.prunedEntries.length}</div>
          <div>Orphan transcripts: {maintenanceReport.orphanTranscripts.length}</div>
          <div>Archived resets: {maintenanceReport.archivedResets.length}</div>
          <div>Store rotated: {maintenanceReport.storeRotated ? 'yes' : 'no'}</div>
          <div>Disk budget evictions: {maintenanceReport.evictedForBudget.length}</div>
          <div>Disk: {maintenanceReport.diskBefore} → {maintenanceReport.diskAfter} bytes</div>
        </div>
      )}
    </div>
  );
}
