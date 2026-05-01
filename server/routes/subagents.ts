import type { Express } from 'express';
import type { SubAgentRegistry } from '../agents/sub-agent-registry';

export interface SubAgentRouteDeps {
  registry: SubAgentRegistry;
  /**
   * Aborts the run with the given runId. Backed by RunCoordinator.abort
   * in production; tests pass a stub.
   */
  abortRun: (runId: string) => void;
}

export function mountSubAgentRoutes(app: Express, deps: SubAgentRouteDeps): void {
  app.post('/api/subagents/:subAgentId/kill', (req, res) => {
    const subAgentId = req.params.subAgentId as string;
    const record = deps.registry.get(subAgentId);
    if (!record) {
      res.status(404).json({ error: 'unknown-sub-agent', subAgentId });
      return;
    }
    if (record.status !== 'running') {
      res.status(409).json({ error: 'not-running', reason: 'not-running', status: record.status });
      return;
    }
    // Order matters: mark killed first, THEN abort. The killed flag prevents
    // onError from clobbering it once abort propagates.
    deps.registry.kill(subAgentId);
    deps.abortRun(record.runId);
    res.status(200).json({ killed: true });
  });

  app.get('/api/subagents/:subAgentId', (req, res) => {
    const record = deps.registry.get(req.params.subAgentId as string);
    if (!record) {
      res.status(404).json({ error: 'unknown-sub-agent' });
      return;
    }
    res.status(200).json(record);
  });

  app.get('/api/subagents', (req, res) => {
    const parentSessionKey = req.query.parentSessionKey;
    if (typeof parentSessionKey !== 'string' || !parentSessionKey) {
      res.status(400).json({ error: 'parentSessionKey query param required' });
      return;
    }
    const records = deps.registry.listForParent(parentSessionKey);
    res.status(200).json(records);
  });
}
