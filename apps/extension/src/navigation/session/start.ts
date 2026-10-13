/** Serialize startup for one native job, retaining concurrency across different jobs. */
export class NavigationStarts {
  private pending = new Map<string, Promise<unknown>>();
  async run<T>(jobId: string, start: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(jobId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(start);
    this.pending.set(jobId, current);
    try {
      return await current;
    } finally {
      if (this.pending.get(jobId) === current) this.pending.delete(jobId);
    }
  }
}
