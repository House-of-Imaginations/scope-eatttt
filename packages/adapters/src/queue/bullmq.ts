import type { JobQueue } from "@scope/core";
import { Queue } from "bullmq";

export interface BullQueueLike {
  add(name: string, data: unknown, opts?: { delay?: number; jobId?: string }): Promise<unknown>;
}

export class BullQueue implements JobQueue {
  constructor(private readonly queue: BullQueueLike) {}

  static fromRedisUrl(name: string, redisUrl: string): BullQueue {
    return new BullQueue(
      new Queue(name, {
        connection: { url: redisUrl, maxRetriesPerRequest: null },
      }),
    );
  }

  async enqueue(
    name: string,
    data: unknown,
    opts?: { delayMs?: number; jobId?: string },
  ): Promise<void> {
    const bullOpts = opts && {
      ...(opts.delayMs === undefined ? {} : { delay: opts.delayMs }),
      ...(opts.jobId === undefined ? {} : { jobId: opts.jobId }),
    };
    await this.queue.add(name, data, bullOpts);
  }
}
