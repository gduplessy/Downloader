import type { ReplayDecision } from '../../../../../packages/shared/src/navigation';
export type ReplayEvidence = {
  method?: string;
  sourceGeneration: number;
  expired?: boolean;
  singleUse?: boolean;
  repeatable?: boolean;
  sameSession?: boolean;
  blob?: boolean;
};
// URL shape and GET are not evidence of repeatability. This runs before probing.
export function classifyReplay(value: ReplayEvidence): ReplayDecision {
  if (!Number.isSafeInteger(value.sourceGeneration) || value.sourceGeneration < 1)
    throw Error('Invalid source generation');
  const result = (disposition: ReplayDecision['disposition'], reason: string): ReplayDecision => ({
    disposition,
    reason,
    source_generation: value.sourceGeneration,
  });
  if (value.expired)
    return result('refresh_required', 'Source expired; obtain a fresh provider action');
  if (value.blob || value.singleUse || (value.method && value.method !== 'GET'))
    return result('browser_stream_only', 'Original response requires direct browser streaming');
  if (value.method === 'GET' && value.repeatable === true && value.sameSession === true)
    return result('replayable', 'Qualified adapter guarantees repeatability in the bound session');
  return result('unknown', 'No qualified evidence permits another origin request');
}
export function permitsProbe(decision: ReplayDecision, generation: number): boolean {
  return decision.disposition === 'replayable' && decision.source_generation === generation;
}
