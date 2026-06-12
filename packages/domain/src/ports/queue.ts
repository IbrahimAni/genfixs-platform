/** Queue abstraction for the event-driven core. BullMQ in production, in-memory in tests/demo. */
export interface Queue {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, handler: (payload: unknown) => Promise<void>): void;
  /** Resolves when all in-flight work (including chained publishes) has drained. */
  drain(): Promise<void>;
}
