import { contextForTab, type ScopeBrowser, type ScopeContext } from './scope';
interface Storage {
  get(key: string): Promise<Record<string, any>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface SourceJob {
  id: string;
  request_id: string;
  source_generation: number;
  private: boolean;
  navigation_owner?: string | null;
  navigation_scope?: ScopeContext | null;
}
interface Origin {
  requestId: string;
  tabId: number;
  windowId: number;
  context: ScopeContext;
  origin: string;
  epoch: string;
  jobId: string | null;
  sourceGeneration: number | null;
}
export class NavigationSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NavigationSourceError';
  }
}
const requiredKey = (requestId: string) => 'navigation-source-required-' + requestId;
const originKey = (requestId: string) => 'navigation-source-origin-' + requestId;
const same = (a: ScopeContext, b: ScopeContext) => JSON.stringify(a) === JSON.stringify(b);
export class NavigationSources {
  private writes = new Map<string, Promise<unknown>>();
  private run<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.writes.get(requestId) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.writes.set(requestId, result);
    void result
      .finally(() => {
        if (this.writes.get(requestId) === result) this.writes.delete(requestId);
      })
      .catch(() => {});
    return result;
  }
  constructor(
    private api: ScopeBrowser,
    private browser: string,
    private profile: Promise<string>,
    private epoch: Promise<string>,
    private transient: Storage,
    private markers: Storage,
    private privateWorker: boolean,
  ) {}
  private validateJob(job: SourceJob) {
    if (
      !job.id ||
      !job.request_id ||
      !Number.isSafeInteger(job.source_generation) ||
      job.source_generation < 1
    )
      throw new NavigationSourceError('navigation_source_generation_invalid');
  }
  prepare(requestId: string, tabId: number) {
    return this.run(requestId, () => this.prepareOrigin(requestId, tabId));
  }
  private async prepareOrigin(requestId: string, tabId: number) {
    if (!requestId || !Number.isInteger(tabId) || tabId < 0)
      throw new NavigationSourceError('navigation_source_missing');
    const context = await contextForTab(this.api, this.browser, await this.profile, tabId).catch(
      () => {
        throw new NavigationSourceError('navigation_source_unavailable');
      },
    );
    if (context.private !== this.privateWorker)
      throw new NavigationSourceError('navigation_source_private_lane_mismatch');
    const tab = await this.api.tabs.get(tabId);
    if (typeof tab.windowId !== 'number' || typeof tab.url !== 'string')
      throw new NavigationSourceError('navigation_source_unavailable');
    const origin: Origin = {
      requestId,
      tabId,
      windowId: tab.windowId,
      context,
      origin: new URL(tab.url).origin,
      epoch: await this.epoch,
      jobId: null,
      sourceGeneration: null,
    };
    // The nonsecret requirement precedes native creation; a poll can see the job before its reply.
    await this.markers.set({ [requiredKey(requestId)]: { required: true } });
    await this.transient.set({ [originKey(requestId)]: origin });
  }
  remember(job: SourceJob, tabId: number) {
    return this.run(job.request_id, () => this.rememberOrigin(job, tabId));
  }
  private async rememberOrigin(job: SourceJob, tabId: number) {
    this.validateJob(job);
    const existing = (await this.markers.get(requiredKey(job.request_id)))[
      requiredKey(job.request_id)
    ];
    if (!existing) {
      await this.prepareOrigin(job.request_id, tabId);
    } else {
      const origin = (await this.transient.get(originKey(job.request_id)))[
        originKey(job.request_id)
      ] as Origin | undefined;
      if (!origin || origin.tabId !== tabId)
        throw new NavigationSourceError('navigation_source_explicit_recovery_required');
    }
    return this.resolveOrigin(job);
  }
  resolve(job: SourceJob): Promise<number | undefined> {
    return this.run(job.request_id, () => this.resolveOrigin(job));
  }
  private async resolveOrigin(job: SourceJob): Promise<number | undefined> {
    this.validateJob(job);
    if (!(await this.markers.get(requiredKey(job.request_id)))[requiredKey(job.request_id)])
      return undefined;
    const origin = (await this.transient.get(originKey(job.request_id)))[
      originKey(job.request_id)
    ] as Origin | undefined;
    if (!origin) throw new NavigationSourceError('navigation_source_explicit_recovery_required');
    if (origin.epoch !== (await this.epoch))
      throw new NavigationSourceError('navigation_source_browser_epoch_changed');
    if (
      origin.requestId !== job.request_id ||
      (origin.jobId && origin.jobId !== job.id) ||
      (origin.sourceGeneration !== null && origin.sourceGeneration !== job.source_generation)
    )
      throw new NavigationSourceError('navigation_source_generation_changed');
    if (job.navigation_owner && job.navigation_owner !== (await this.profile))
      throw new NavigationSourceError('navigation_source_owner_changed');
    if (origin.context.private !== job.private || origin.context.profile !== (await this.profile))
      throw new NavigationSourceError('navigation_source_session_changed');
    const current = await contextForTab(
      this.api,
      this.browser,
      await this.profile,
      origin.tabId,
    ).catch(() => {
      throw new NavigationSourceError('navigation_source_unavailable');
    });
    const tab = await this.api.tabs.get(origin.tabId).catch(() => {
      throw new NavigationSourceError('navigation_source_unavailable');
    });
    if (
      !same(current, origin.context) ||
      tab.windowId !== origin.windowId ||
      !tab.url ||
      new URL(tab.url).origin !== origin.origin
    )
      throw new NavigationSourceError('navigation_source_session_changed');
    if (
      job.navigation_scope &&
      (job.navigation_scope.private !== current.private ||
        job.navigation_scope.cookie_store_id !== current.cookie_store_id ||
        job.navigation_scope.container_id !== current.container_id ||
        job.navigation_scope.profile !== current.profile)
    )
      throw new NavigationSourceError('navigation_source_explicit_transfer_required');
    origin.jobId = job.id;
    origin.sourceGeneration = job.source_generation;
    await this.transient.set({ [originKey(job.request_id)]: origin });
    await this.markers.set({
      [requiredKey(job.request_id)]: {
        required: true,
        jobId: job.id,
        sourceGeneration: job.source_generation,
      },
    });
    return origin.tabId;
  }
  invalidate(job: Pick<SourceJob, 'request_id'>) {
    return this.run(job.request_id, async () => {
      if (job.request_id) await this.transient.remove(originKey(job.request_id));
    });
  }
  adopted(job: Pick<SourceJob, 'request_id'>) {
    return this.run(job.request_id, async () => {
      if (!job.request_id) return;
      await this.transient.remove(originKey(job.request_id));
      await this.markers.remove(requiredKey(job.request_id));
    });
  }
}
