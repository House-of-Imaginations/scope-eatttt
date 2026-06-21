export interface JobOptions {
  delayMs?: number;
  jobId?: string;
}

export interface JobQueue {
  enqueue(name: string, data: unknown, opts?: JobOptions): Promise<void>;
}
