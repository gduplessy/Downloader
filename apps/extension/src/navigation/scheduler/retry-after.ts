import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';
import { retryAfter, observeServerWait, type DurableWait } from './waits';

export interface ServerAuthority {
  id: string;
  tabId: number;
  scope: SessionScope;
  sourceGeneration: number;
  sessionEpoch: string;
}
export interface ServerResponse extends ServerAuthority {
  requestId: string;
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
};
type Response = Request & {
  documentId?: string;
  statusCode: number;
  responseHeaders?: { name: string; value?: string }[];
};
/** Register synchronously before any asynchronous owner lookup. URL never selects authority. */
export class RetryAfterRequests {
  private pending = new Map<
    number,
    {
      request: Request;
      authority: Promise<ServerAuthority | null>;
      observed: number;
      used: boolean;
    }
  >();
  constructor(private now: () => number = Date.now) {}
  begin(request: Request, authority: Promise<ServerAuthority | null>) {
    if (request.type !== 'main_frame' || request.frameId !== 0 || request.tabId < 0) return;
    this.pending.set(request.tabId, {
      request: { ...request },
      authority,
      observed: this.now(),
      used: false,
    });
    for (const [tab, entry] of this.pending)
      if (this.now() - entry.observed > 120000) this.pending.delete(tab);
    if (this.pending.size > 1024) this.pending.delete(this.pending.keys().next().value!);
  }
  removeTab(tabId: number) {
    this.pending.delete(tabId);
  }
  current(response: ServerResponse) {
    const entry = this.pending.get(response.tabId);
    return entry?.request.requestId === response.requestId;
  }
  async headers(response: Response): Promise<ServerResponse | null> {
    const entry = this.pending.get(response.tabId);
    if (
      !entry ||
      entry.used ||
      response.frameId !== 0 ||
      response.type !== 'main_frame' ||
      entry.request.requestId !== response.requestId ||
      entry.request.url !== response.url ||
      !response.documentId ||
      ![429, 503].includes(response.statusCode)
    )
      return null;
    const values = response.responseHeaders?.filter((h) => h.name.toLowerCase() === 'retry-after');
    if (values?.length !== 1) return null;
    const observedAt = this.now(),
      deadline = retryAfter(values[0].value ?? null, observedAt);
    if (deadline === null) return null;
    entry.used = true;
    const authority = await entry.authority;
    if (
      this.pending.get(response.tabId) !== entry ||
      !authority ||
      authority.tabId !== response.tabId ||
      authority.scope.private !== !!entry.request.incognito ||
      authority.scope.private !== !!response.incognito ||
      this.now() - entry.observed > 120000
    )
      return null;
    return {
      ...authority,
      requestId: response.requestId,
      documentId: response.documentId,
      observedAt,
      deadline,
    };
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
  );
}
