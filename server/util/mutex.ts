/**
 * A single-lane async mutex. Each `run()` call is appended to an internal
 * promise chain so the supplied callbacks execute strictly one at a time,
 * even across `await` boundaries. This is the primitive that turns an unsafe
 * read-modify-write (read state -> await -> write state) into an atomic
 * critical section.
 *
 * The chain never rejects: a callback that throws still releases the lock for
 * the next waiter, and only the caller of that specific `run()` sees the
 * rejection.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * A collection of independent mutexes addressed by string key — e.g. one lock
 * per file path or per session — so unrelated keys run concurrently while
 * operations sharing a key are serialized.
 */
export class KeyedMutex {
  private locks = new Map<string, Mutex>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(key, lock);
    }
    return lock.run(fn);
  }
}
