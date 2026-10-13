import type { SessionScope, StreamIdentity } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';

/** Prevent download observers from racing an approved original-response stream. */
export class DirectCaptureOwners {
  private active = new Map<number, { jobId: string; identity: StreamIdentity }>();
  assign(tabId: number, jobId: string, identity: StreamIdentity) {
    this.active.set(tabId, { jobId, identity: structuredClone(identity) });
  }
  release(tabId: number, streamId: string) {
    if (this.active.get(tabId)?.identity.stream_id === streamId) this.active.delete(tabId);
  }
  owns(tabId: number, jobId: string, scope: SessionScope | undefined, sourceGeneration: number) {
    const owner = this.active.get(tabId);
    return !!owner && !!scope && owner.jobId === jobId &&
      owner.identity.source_generation === sourceGeneration && sameScope(owner.identity.scope, scope);
  }
}
