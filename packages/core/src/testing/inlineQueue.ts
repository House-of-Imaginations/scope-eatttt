import type { JobOptions, JobQueue } from "../ports/queue";

export type InlineQueueHandler = (data: unknown) => void | Promise<void>;

export interface EnqueuedJobRecord {
  name: string;
  data: unknown;
  opts?: JobOptions;
}

export class InlineQueue implements JobQueue {
  readonly enqueued: EnqueuedJobRecord[] = [];

  private readonly handlers = new Map<string, InlineQueueHandler>();

  handle(name: string, handler: InlineQueueHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown, opts?: JobOptions): Promise<void> {
    const job: EnqueuedJobRecord = { name, data };
    if (opts) {
      job.opts = opts;
    }
    this.enqueued.push(job);

    const handler = this.handlers.get(name);
    if (handler) {
      await handler(data);
    }
  }
}
