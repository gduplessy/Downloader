import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';
import { retryAfter, observeServerWait, waitFingerprint, type DurableWait } from './waits';

export interface ServerAuthority {
  id: string;
  tabId: number;
  scope: SessionScope;
  sourceGeneration: number;
  sessionEpoch: string;
}
export interface ServerResponse extends ServerAuthority {
  requestId: string;
  fingerprint: string;
  documentId: string;
  observedAt: number;
  deadline: number;
}
type Request = {
  requestId: string;
  tabId: number;
  frameId: number;
  type: string;
  url: string;
  incognito?: boolean;
  timeStamp?: number;
};
type Response = Request & {
  documentId?: string;
  statusCode: number;
  responseHeaders?: { name: string; value?: string }[];
};
type Committed = {
  tabId: number;
  frameId: number;
  documentId?: string;
  url: string;
  timeStamp: number;
  documentLifecycle?: string;
};
type Entry = {
  request: Request;
  authority: Promise<ServerAuthority | null>;
  observed: number;
  first: boolean;
  header?: { observedAt: number; deadline: number; documentId?: string; private: boolean };
  documentId?: string;
  emitted: boolean;
};
/** Exact request plus browser committed-document lifecycle, never a URL-only authority lookup. */
export class RetryAfterRequests {
  private pending = new Map<number, Entry>();
  private counts = new Map<number, number>();
  constructor(private now: () => number = Date.now) {}
  begin(request: Request, authority: Promise<ServerAuthority | null>) {
    if (request.type !== 'main_frame' || request.frameId !== 0 || request.tabId < 0) return;
    const count = (this.counts.get(request.tabId) ?? 0) + 1;
    this.counts.set(request.tabId, count);
    const first = count === 1;
    this.pending.set(request.tabId, {
      request: { ...request },
      authority,
      observed: this.now(),
      first,
      emitted: false,
    });
    for (const [tab, entry] of this.pending)
      if (this.now() - entry.observed > 120000) this.pending.delete(tab);
    if (this.counts.size > 1024) {
      const oldest = this.counts.keys().next().value!;
      this.counts.delete(oldest);
      this.pending.delete(oldest);
    }
  }
  removeTab(tabId: number) {
    this.pending.delete(tabId);
    this.counts.delete(tabId);
  }
  // A later navigation intent without a network request (including BFCache) must fence a pending response.
  navigating(tabId: number, timeStamp: number) {
    const entry = this.pending.get(tabId);
    if (
      entry &&
      (!Number.isFinite(timeStamp) || timeStamp > (entry.request.timeStamp ?? entry.observed))
    )
      this.pending.delete(tabId);
  }
  current(response: ServerResponse) {
    const entry = this.pending.get(response.tabId);
    return (
      entry?.request.requestId === response.requestId && entry.documentId === response.documentId
    );
  }
  private async take(entry: Entry): Promise<ServerResponse | null> {
    if (!entry.header || !entry.documentId || entry.emitted) return null;
    const authority = await entry.authority;
    if (
      this.pending.get(entry.request.tabId) !== entry ||
      entry.emitted ||
      !authority ||
      authority.tabId !== entry.request.tabId ||
      authority.scope.private !== !!entry.request.incognito ||
      authority.scope.private !== entry.header.private ||
      this.now() - entry.observed > 120000 ||
      (entry.header.documentId && entry.header.documentId !== entry.documentId)
    )
      return null;
    const fingerprint = await waitFingerprint(
      JSON.stringify([
        entry.request.requestId,
        entry.documentId,
        authority.id,
        authority.sourceGeneration,
        authority.scope.claim_generation,
      ]),
    );
    if (this.pending.get(entry.request.tabId) !== entry || entry.emitted) return null;
    entry.emitted = true;
    return {
      ...authority,
      requestId: entry.request.requestId,
      fingerprint,
      documentId: entry.documentId,
      observedAt: entry.header.observedAt,
      deadline: entry.header.deadline,
    };
  }
  async headers(response: Response): Promise<ServerResponse | null> {
    const entry = this.pending.get(response.tabId);
    if (
      !entry ||
      entry.header ||
      response.frameId !== 0 ||
      response.type !== 'main_frame' ||
      entry.request.requestId !== response.requestId ||
      entry.request.url !== response.url ||
      ![429, 503].includes(response.statusCode)
    )
      return null;
    const values = response.responseHeaders?.filter((h) => h.name.toLowerCase() === 'retry-after');
    if (values?.length !== 1) return null;
    const observedAt = this.now(),
      deadline = retryAfter(values[0].value ?? null, observedAt);
    if (deadline === null) return null;
    entry.header = {
      observedAt,
      deadline,
      documentId: response.documentId,
      private: !!response.incognito,
    };
    return this.take(entry);
  }
  async committed(commit: Committed): Promise<ServerResponse | null> {
    const entry = this.pending.get(commit.tabId);
    if (
      !entry ||
      !Number.isFinite(commit.timeStamp) ||
      commit.frameId !== 0 ||
      !commit.documentId ||
      commit.url !== entry.request.url ||
      commit.timeStamp < (entry.request.timeStamp ?? entry.observed) ||
      (commit.documentLifecycle && commit.documentLifecycle !== 'active')
    )
      return null;
    if (entry.documentId && entry.documentId !== commit.documentId) {
      this.pending.delete(commit.tabId);
      return null;
    }
    entry.documentId = commit.documentId;
    return this.take(entry);
  }
  /** Only the actual newly created tab receipt may adopt its first observed request after native claiming. */
  async adoptInitial(
    authority: ServerAuthority,
    intent: { id: string; sourceGeneration: number; url: string; createdAt: number },
  ): Promise<ServerResponse | null> {
    const entry = this.pending.get(authority.tabId);
    if (
      !entry ||
      !entry.first ||
      entry.emitted ||
      authority.id !== intent.id ||
      authority.sourceGeneration !== intent.sourceGeneration ||
      entry.request.url !== intent.url ||
      entry.observed < intent.createdAt ||
      this.now() - intent.createdAt > 120000 ||
      !Number.isFinite(intent.createdAt)
    )
      return null;
    entry.authority = Promise.resolve(authority);
    return this.take(entry);
  }
}
export function serverResponseWait(
  response: ServerResponse,
  current: ServerAuthority & { documentId?: string },
  previous: DurableWait | undefined,
  now: number,
): DurableWait | null {
  if (
    response.id !== current.id ||
    response.tabId !== current.tabId ||
    !sameScope(response.scope, current.scope) ||
    response.sourceGeneration !== current.sourceGeneration ||
    response.sessionEpoch !== current.sessionEpoch ||
    !/^wait:[a-f0-9]{64}$/.test(response.fingerprint ?? '') ||
    !current.documentId ||
    response.documentId !== current.documentId ||
    !Number.isSafeInteger(response.observedAt) ||
    !Number.isSafeInteger(response.deadline) ||
    response.observedAt > now ||
    now - response.observedAt > 120000 ||
    response.deadline < response.observedAt ||
    response.deadline - response.observedAt > 604800000
  )
    return null;
  return observeServerWait(
    previous,
    current.sourceGeneration,
    response.deadline,
    response.observedAt,
    response.fingerprint,
  );
}

/** Keep invalidation in the same storage queue as response writes so neither late nor fresh writes are erased out of order. */
export function enqueueServerResponseWrite(
  writes: Map<number, Promise<void>>,
  tabId: number,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = writes.get(tabId) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(operation);
  writes.set(tabId, write);
  void write
    .catch(() => {})
    .finally(() => {
      if (writes.get(tabId) === write) writes.delete(tabId);
    });
  return write;
}
