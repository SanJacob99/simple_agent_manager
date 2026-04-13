import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import crypto from 'crypto';
import { WebhookHandler } from './webhook-handler';

describe('WebhookHandler', () => {
  it('prevents DoS by verifying buffer byte lengths before timingSafeEqual', async () => {
    // This is essentially a manual mock of the express app
    const app = { post: vi.fn() } as unknown as express.Express;

    const handler = new WebhookHandler([{
      id: 'test',
      path: '/test',
      agentId: 'agent1',
      secret: 'mysecret'
    }], vi.fn());

    handler.registerRoutes(app);

    const routeHandler = (app.post as any).mock.calls[0][1];

    const req = {
      headers: {
        'x-webhook-signature': 'shorter' // shorter than expected
      },
      body: { message: 'hello' }
    } as unknown as express.Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as unknown as express.Response;

    // Should not throw a RangeError
    await expect(routeHandler(req, res)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });
});
