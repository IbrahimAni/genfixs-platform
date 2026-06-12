import type { Queue } from '../ports/queue.js';

/**
 * Immediate-dispatch in-memory queue. Handlers run asynchronously; drain() awaits
 * the full cascade so pipeline tests can assert end state deterministically.
 */
export class InMemoryQueue implements Queue {
  private readonly handlers = new Map<string, Array<(payload: unknown) => Promise<void>>>();
  private inFlight: Promise<void>[] = [];
  /** Handler errors are collected, not swallowed; tests fail loudly on them. */
  readonly errors: unknown[] = [];

  async publish(topic: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(topic) ?? [];
    for (const handler of handlers) {
      const job = handler(payload).catch((err) => {
        this.errors.push(err);
      });
      this.inFlight.push(job);
    }
  }

  subscribe(topic: string, handler: (payload: unknown) => Promise<void>): void {
    const existing = this.handlers.get(topic) ?? [];
    existing.push(handler);
    this.handlers.set(topic, existing);
  }

  async drain(): Promise<void> {
    while (this.inFlight.length > 0) {
      const batch = this.inFlight;
      this.inFlight = [];
      await Promise.all(batch);
    }
  }
}
