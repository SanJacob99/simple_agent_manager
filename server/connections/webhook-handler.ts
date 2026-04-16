import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import type { RunCoordinator } from '../agents/run-coordinator';

export interface WebhookConfig {
  id: string;
  path: string;
  agentId: string;
  secret?: string;
  sessionKeyOverride?: string;
}

export class WebhookHandler {
  constructor(
    private readonly webhooks: WebhookConfig[],
    private readonly coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  registerRoutes(app: Express): void {
    for (const webhook of this.webhooks) {
      const routePath = `/api/webhook/${webhook.path.replace(/^\//, '')}`;

      app.post(routePath, async (req: Request, res: Response) => {
        // Validate HMAC if secret is configured
        if (webhook.secret) {
          const signature = req.headers['x-webhook-signature'] as string | undefined;
          if (!signature) {
            res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
            return;
          }

          const expected = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(req.body))
            .digest('hex');

          const sigBuffer = Buffer.from(signature);
          const expBuffer = Buffer.from(expected);

          if (
            sigBuffer.byteLength !== expBuffer.byteLength ||
            !crypto.timingSafeEqual(sigBuffer, expBuffer)
          ) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
          }
        }

        const coordinator = this.coordinatorLookup(webhook.agentId);
        if (!coordinator) {
          res.status(404).json({ error: `Agent ${webhook.agentId} not found` });
          return;
        }

        // Extract message from body
        const message = typeof req.body.message === 'string'
          ? req.body.message
          : typeof req.body.text === 'string'
            ? req.body.text
            : JSON.stringify(req.body);

        const sessionKey = webhook.sessionKeyOverride ?? `hook:${webhook.id}`;

        try {
          const dispatched = await coordinator.dispatch({
            sessionKey,
            text: message,
          });

          res.status(202).json({ runId: dispatched.runId, sessionKey });
        } catch (err) {
          res.status(500).json({ error: (err as Error).message });
        }
      });
    }
  }
}
