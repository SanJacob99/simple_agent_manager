import express from 'express';
import type { CoordinationService } from './coordination-service';
import type {
  AssignTaskInput,
  CreateWorkflowInput,
  TaskBlockedInput,
  TaskCompleteInput,
  TaskUpdateInput,
} from '../../shared/coordination-types';

function caller(req: express.Request): string {
  // TODO(coordination-auth): V1 is local-first and trusts callerAgentId from
  // the request. Replace this with authenticated agent/run identity before
  // exposing coordination routes beyond the local desktop process.
  const fromBody = typeof req.body?.callerAgentId === 'string' ? req.body.callerAgentId : '';
  const fromQuery = typeof req.query.callerAgentId === 'string' ? req.query.callerAgentId : '';
  const agentId = fromBody || fromQuery;
  if (!agentId) throw new Error('callerAgentId is required');
  return agentId;
}

function sendError(res: express.Response, err: unknown): void {
  res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
}

export function buildCoordinationRouter(service: CoordinationService) {
  const r = express.Router();

  r.post('/api/coordination/agents/sync', (req, res) => {
    try {
      res.json({ agents: service.syncAgents(req.body) });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/api/coordination/agents', (_req, res) => {
    res.json({ agents: service.listAgents() });
  });

  r.get('/api/coordination/workflows', (_req, res) => {
    res.json({ workflows: service.listWorkflowSummaries() });
  });

  r.post('/api/coordination/workflows', (req, res) => {
    try {
      const workflow = service.createWorkflow(caller(req), req.body as CreateWorkflowInput);
      res.status(201).json(workflow);
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/api/coordination/workflows/:workflowId', (req, res) => {
    const detail = service.getWorkflowDetail(req.params.workflowId);
    if (!detail) {
      res.status(404).json({ error: 'workflow not found' });
      return;
    }
    res.json(detail);
  });

  r.post('/api/coordination/workflows/:workflowId/start', (req, res) => {
    try {
      res.json(service.startWorkflow(caller(req), req.params.workflowId));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/workflows/:workflowId/pause', (req, res) => {
    try {
      res.json(service.pauseWorkflow(
        caller(req),
        req.params.workflowId,
        String(req.body?.reason ?? 'Paused by manager'),
      ));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/workflows/:workflowId/resume', (req, res) => {
    try {
      res.json(service.resumeWorkflow(caller(req), req.params.workflowId));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/workflows/:workflowId/stop', (req, res) => {
    try {
      res.json(service.stopWorkflow(
        caller(req),
        req.params.workflowId,
        String(req.body?.reason ?? 'Stopped by manager'),
      ));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/workflows/:workflowId/report', (req, res) => {
    try {
      res.json(service.requestReport(caller(req), req.params.workflowId));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/api/coordination/workflows/:workflowId/trace', (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    res.json({ events: service.getTrace(req.params.workflowId, limit) });
  });

  r.post('/api/coordination/tasks', (req, res) => {
    try {
      const { callerAgentId: _caller, ...input } = req.body as AssignTaskInput & { callerAgentId?: string };
      res.status(201).json(service.assignTask(caller(req), input));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/tasks/:taskId/update', (req, res) => {
    try {
      const input = { ...(req.body as TaskUpdateInput), taskId: req.params.taskId };
      res.json(service.taskUpdate(caller(req), input));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/tasks/:taskId/blocked', (req, res) => {
    try {
      const input = { ...(req.body as TaskBlockedInput), taskId: req.params.taskId };
      res.json(service.taskBlocked(caller(req), input));
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/coordination/tasks/:taskId/complete', (req, res) => {
    try {
      const input = { ...(req.body as TaskCompleteInput), taskId: req.params.taskId };
      res.json(service.taskComplete(caller(req), input));
    } catch (err) {
      sendError(res, err);
    }
  });

  return r;
}
