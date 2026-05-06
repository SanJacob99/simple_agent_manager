type Task<T> = () => Promise<T>;

interface QueueState {
  /**
   * True while a task body is executing synchronously (i.e., between when
   * the task callback is invoked and when its returned promise settles).
   * Used to detect reentrant enqueues.
   */
  running: boolean;
  /**
   * True whenever there is at least one task queued or running on this channel.
   * Reflects the logical "active" state visible via isActive().
   */
  pending: boolean;
  /** The tail of the promise chain — new tasks serialize after this. */
  tail: Promise<unknown>;
}

/**
 * Per-channel FIFO scheduler. Different channels run in parallel; same-channel
 * tasks serialize. Reentrant enqueues (from inside a running task) are queued
 * after the outer task yields — they do not deadlock.
 *
 * Errors in a task do not poison the queue: the next task runs normally.
 */
export class ChannelRunQueue {
  private readonly states = new Map<string, QueueState>();

  /** Returns true if there is at least one task queued or running on the channel. */
  isActive(channelKey: string): boolean {
    return this.states.get(channelKey)?.pending ?? false;
  }

  enqueue<T>(channelKey: string, task: Task<T>): Promise<T> {
    const existing = this.states.get(channelKey);

    if (existing?.running) {
      // Reentrant case: a task body on this channel is currently executing and
      // called us. We must NOT chain on `tail` because that would deadlock if
      // the running task body `await`s our returned promise.
      //
      // Instead, schedule the inner task independently on a fresh resolved
      // promise so it runs as soon as the outer task suspends (yields). We
      // then merge back into `tail` so any subsequent non-reentrant enqueues
      // wait for us to finish.
      const inner = this._makeTask(channelKey, task);

      // Subsequent enqueues must wait for both the existing tail (outer task)
      // and the inner task.
      existing.tail = existing.tail.then(() => inner, () => inner);

      return inner as Promise<T>;
    }

    if (!existing) {
      // First task on this channel: create state and mark pending immediately.
      const state: QueueState = { running: false, pending: true, tail: Promise.resolve() };
      this.states.set(channelKey, state);
      const next = this._makeTask(channelKey, task);
      state.tail = next;
      return next as Promise<T>;
    }

    // Non-reentrant, non-first: serialize after the existing tail.
    existing.pending = true;
    const next = existing.tail.then(
      () => this._runTask(channelKey, task),
      () => this._runTask(channelKey, task), // upstream rejection: still run
    );
    existing.tail = next;
    return next as Promise<T>;
  }

  /** Creates a new task promise that starts in the next microtask. */
  private _makeTask<T>(channelKey: string, task: Task<T>): Promise<T> {
    return Promise.resolve().then(() => this._runTask(channelKey, task));
  }

  /** Runs the task body, managing running/pending flags. */
  private async _runTask<T>(channelKey: string, task: Task<T>): Promise<T> {
    const s = this.states.get(channelKey);
    if (s) {
      s.running = true;
      s.pending = true;
    }
    try {
      return await task();
    } finally {
      const s2 = this.states.get(channelKey);
      if (s2) {
        s2.running = false;
        s2.pending = false;
      }
    }
  }
}
