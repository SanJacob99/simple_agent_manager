import { describe, expect, it } from 'vitest';
import { RunConcurrencyController } from './run-concurrency-controller';

describe('RunConcurrencyController', () => {
  it('assigns 1-based session and global queue positions on enqueue', () => {
    const controller = new RunConcurrencyController();

    const first = controller.enqueue('run-1', 'sess-a');
    const second = controller.enqueue('run-2', 'sess-a');
    const third = controller.enqueue('run-3', 'sess-b');

    expect(first.snapshot).toEqual({ sessionPosition: 1, globalPosition: 1 });
    expect(second.snapshot).toEqual({ sessionPosition: 2, globalPosition: 2 });
    expect(third.snapshot).toEqual({ sessionPosition: 1, globalPosition: 3 });
  });

  it('drains the earliest global run that is also a session head', () => {
    const controller = new RunConcurrencyController();

    controller.enqueue('run-1', 'sess-a');
    controller.enqueue('run-2', 'sess-a');
    controller.enqueue('run-3', 'sess-b');

    expect(controller.drain()).toEqual({ runId: 'run-1', sessionId: 'sess-a' });

    controller.start('run-1', 'sess-a');
    expect(controller.drain()).toBeNull();

    controller.release('run-1', 'sess-a');
    expect(controller.drain()).toEqual({ runId: 'run-2', sessionId: 'sess-a' });
  });

  it('abortPending removes a queued run and updates the remaining snapshots', () => {
    const controller = new RunConcurrencyController();

    controller.enqueue('run-1', 'sess-a');
    controller.enqueue('run-2', 'sess-b');
    controller.enqueue('run-3', 'sess-b');

    const result = controller.abortPending('run-2');

    expect(result.removed).toBe(true);
    expect(controller.getSnapshot('run-2')).toBeNull();
    expect(controller.getSnapshot('run-3')).toEqual({ sessionPosition: 1, globalPosition: 2 });
  });
});
