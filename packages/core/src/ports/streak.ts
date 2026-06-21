export interface StreakStore {
  incr(sessionId: string, userId: string): Promise<number>;
  reset(sessionId: string, userId: string): Promise<void>;
  get(sessionId: string, userId: string): Promise<number>;
}
