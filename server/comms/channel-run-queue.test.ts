import { describe, it, expect } from 'vitest';
import { ChannelRunQueue } from './channel-run-queue';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('ChannelRunQueue', () => {
  it('serializes tasks on a single channel', async () => {
    const q = new ChannelRunQueue();
    const order: number[] = [];
    const a = q.enqueue('chan:a:b', async () => {
      order.push(1);
      await sleep(20);
      order.push(2);
    });
    const b = q.enqueue('chan:a:b', async () => {
      order.push(3);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs different channels in parallel', async () => {
    const q = new ChannelRunQueue();
    const order: string[] = [];
    const a = q.enqueue('c1', async () => {
      await sleep(20);
      order.push('a');
    });
    const b = q.enqueue('c2', async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    // c2 finishes first because c1 sleeps
    expect(order).toEqual(['b', 'a']);
  });

  it('reentrant enqueue from inside an active task does not deadlock', async () => {
    const q = new ChannelRunQueue();
    const order: string[] = [];
    await q.enqueue('c1', async () => {
      order.push('outer-start');
      const reentrant = q.enqueue('c1', async () => order.push('inner'));
      order.push('outer-end');
      await reentrant;
    });
    expect(order).toEqual(['outer-start', 'outer-end', 'inner']);
  });

  it('isActive reflects current state', async () => {
    const q = new ChannelRunQueue();
    expect(q.isActive('c1')).toBe(false);
    const p = q.enqueue('c1', async () => {
      await sleep(10);
    });
    expect(q.isActive('c1')).toBe(true);
    await p;
    expect(q.isActive('c1')).toBe(false);
  });

  it('returns the task result via the promise', async () => {
    const q = new ChannelRunQueue();
    const v = await q.enqueue('c1', async () => 42);
    expect(v).toBe(42);
  });

  it('a task that throws does not poison the queue', async () => {
    const q = new ChannelRunQueue();
    const a = q.enqueue('c1', async () => {
      throw new Error('boom');
    });
    await expect(a).rejects.toThrow('boom');
    const b = await q.enqueue('c1', async () => 'ok');
    expect(b).toBe('ok');
  });
});
