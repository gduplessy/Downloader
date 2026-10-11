export type EventJob = { id: string; created?: string };
export type EventSnapshot<J extends EventJob> = { sequence: number; jobs: J[] };
export type EventBatch<S> = {
  snapshot: S | null;
  sequence: number;
  has_more: boolean;
  events: { type: string; sequence: number; job?: EventJob; id?: string }[];
};
export function applyEvents<J extends EventJob, S extends EventSnapshot<J>>(
  current: S | null,
  batch: EventBatch<S>,
): S | null {
  if (batch.snapshot) return batch.snapshot;
  if (!current || batch.events.some((e) => ['settings_changed', 'queues_changed'].includes(e.type)))
    return null;
  if (batch.sequence < current.sequence) return current;
  const jobs = new Map(current.jobs.map((j) => [j.id, j]));
  for (const event of batch.events) {
    if (event.sequence <= current.sequence) continue;
    if (event.type === 'job_removed' && event.id) jobs.delete(event.id);
    if (['job_lifecycle', 'job_progress'].includes(event.type) && event.job)
      jobs.set(event.job.id, event.job as J);
  }
  return { ...current, sequence: batch.sequence, jobs: [...jobs.values()] };
}
