import type { SessionScope } from '../../../../../packages/shared/src/navigation';
export type ChallengeBinding = {
  scope: SessionScope;
  sourceGeneration: number;
  documentGeneration: number;
  page: string;
  selectedHost: string;
  imageDigest: string;
  csrfDigest: string;
  formDigest: string;
  expiresAt: number;
};
export class ChallengeGate {
  private used = new Set<string>();
  private cancelled = new Set<string>();
  cancel(binding: ChallengeBinding) {
    this.cancelled.add(JSON.stringify(binding));
  }
  authorize(expected: ChallengeBinding, current: ChallengeBinding, now: number) {
    const key = JSON.stringify(expected);
    if (
      JSON.stringify(expected) !== JSON.stringify(current) ||
      !current.selectedHost ||
      current.scope.claim_generation < 1 ||
      now >= current.expiresAt ||
      this.cancelled.has(key)
    )
      throw Error('challenge_stale');
    if (this.used.has(key)) throw Error('challenge_already_submitted');
    this.used.add(key);
  }
}
