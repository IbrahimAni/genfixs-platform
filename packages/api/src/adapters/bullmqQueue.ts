import type { Queue as QueuePort } from '@genfixs/domain';
import { Queue as BullQueue, Worker } from 'bullmq';

/**
 * BullMQ adapter for the Queue port (DECISIONS.md D2). Used when REDIS_URL is
 * configured; the InMemoryQueue fake is the default everywhere else.
 */
export class BullMqQueue implements QueuePort {
  private readonly queues = new Map<string, BullQueue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly connection: { host: string; port: number }) {}

  static fromUrl(url: string): BullMqQueue {
    const parsed = new URL(url);
    return new BullMqQueue({ host: parsed.hostname, port: Number(parsed.port || 6379) });
  }

  private queue(topic: string): BullQueue {
    let q = this.queues.get(topic);
    if (!q) {
      q = new BullQueue(topic, { connection: this.connection });
      this.queues.set(topic, q);
    }
    return q;
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    await this.queue(topic).add(topic, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  subscribe(topic: string, handler: (payload: unknown) => Promise<void>): void {
    this.workers.push(
      new Worker(topic, async (job) => handler(job.data), { connection: this.connection }),
    );
  }

  async drain(): Promise<void> {
    // BullMQ has no synchronous drain; pipeline tests use the in-memory queue.
    // Production flow is fire-and-forget with worker retries.
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers.map((w) => w.close()), ...[...this.queues.values()].map((q) => q.close())]);
  }
}
