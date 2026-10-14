import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { Job } from '../types';
import type { SessionScope } from '../../../../packages/shared/src/navigation';
import { transferLabels, type TransferLabel } from './NavigationTransfer.labels';

type Request = (args: unknown) => Promise<any>;
export type NavigationTransferProps = {
  job: Job;
  locale: string;
  request: Request;
  refresh: () => Promise<void>;
};
type Prepared = {
  token: string;
  expires_at_ms: number;
  id: string;
  scope: SessionScope;
  source_generation: number;
};
type Phase =
  'idle' | 'preparing' | 'ready' | 'cancelling' | 'cancelled' | 'expired' | 'stale' | 'failed';
type View = { phase: Phase; seconds: number; error: TransferLabel | null };
const CODE_LIFETIME_MS = 5 * 60 * 1000;
type Preparation = {
  input: Job;
  fence: string;
  expectedScope: SessionScope;
  expectedSource: number;
  monotonicLimit: number;
  observedFrozen: boolean;
};
type NativeJobFields = {
  navigation_owner?: string | null;
  private?: boolean;
  partial_created?: boolean;
};
const safeCounter = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
function validScope(scope: SessionScope | null | undefined): scope is SessionScope {
  if (
    !scope ||
    !['chromium', 'firefox'].includes(scope.browser) ||
    typeof scope.profile !== 'string' ||
    !scope.profile ||
    typeof scope.private !== 'boolean' ||
    typeof scope.cookie_store_id !== 'string' ||
    !scope.cookie_store_id ||
    !safeCounter(scope.claim_generation) ||
    (scope.container_id != null && typeof scope.container_id !== 'string')
  )
    return false;
  if (scope.partition_key != null) {
    try {
      if (!['http:', 'https:'].includes(new URL(scope.partition_key.top_level_site).protocol))
        return false;
    } catch {
      return false;
    }
    if (
      scope.partition_key.has_cross_site_ancestor != null &&
      typeof scope.partition_key.has_cross_site_ancestor !== 'boolean'
    )
      return false;
  }
  return true;
}

function scopeKey(scope: SessionScope) {
  return JSON.stringify([
    scope.browser,
    scope.profile,
    scope.private,
    scope.cookie_store_id,
    scope.container_id,
    scope.partition_key?.top_level_site ?? null,
    scope.partition_key?.has_cross_site_ancestor ?? null,
    scope.claim_generation,
  ]);
}
function jobFence(job: Job) {
  return JSON.stringify([
    job.id,
    job.navigation_scope ? scopeKey(job.navigation_scope) : null,
    job.source_generation,
    job.state,
    job.bytes,
    job.segments?.some((segment) => segment.downloaded !== 0) ?? false,
    (job as Job & NativeJobFields).partial_created ?? false,
    (job as Job & NativeJobFields).navigation_owner ?? null,
    (job as Job & NativeJobFields).private ?? job.navigation_scope?.private,
    job.navigation_transfer_pending ?? false,
    job.navigation_transfer_recovery ?? false,
  ]);
}
function waitingWithoutData(job: Job) {
  return (
    ['waiting_browser', 'waiting_user'].includes(job.state) &&
    job.bytes === 0 &&
    !(job as Job & { partial_created?: boolean }).partial_created &&
    !(job.segments ?? []).some((segment) => segment.downloaded !== 0)
  );
}
function expectedPending(job: Job, preparation: Preparation) {
  const input = preparation.input;
  return (
    job.id === input.id &&
    validScope(job.navigation_scope) &&
    scopeKey(job.navigation_scope) === scopeKey(preparation.expectedScope) &&
    job.source_generation === preparation.expectedSource &&
    job.navigation_transfer_pending === true &&
    job.navigation_transfer_recovery !== true &&
    job.state === 'waiting_user' &&
    waitingWithoutData(job) &&
    ((job as Job & NativeJobFields).navigation_owner ?? null) ===
      ((input as Job & NativeJobFields).navigation_owner ?? null) &&
    ((job as Job & NativeJobFields).private ?? job.navigation_scope.private) ===
      ((input as Job & NativeJobFields).private ?? input.navigation_scope!.private)
  );
}

export function canPrepareTransfer(job: Job) {
  return (
    validScope(job.navigation_scope) &&
    safeCounter(job.source_generation) &&
    job.source_generation < Number.MAX_SAFE_INTEGER &&
    job.navigation_scope.claim_generation < Number.MAX_SAFE_INTEGER &&
    waitingWithoutData(job) &&
    !job.navigation_transfer_pending &&
    (job as Job & { browser_source?: boolean }).browser_source !== false
  );
}
function errorLabel(error: unknown): TransferLabel {
  const message = String((error as { code?: unknown })?.code ?? error);
  for (const [code, label] of [
    ['partial_data_requires_recovery', 'partial'],
    ['solver_cleanup_required', 'solver'],
    ['scope_stale', 'stale'],
    ['scope_invalid', 'unavailable'],
    ['job_not_waiting', 'unavailable'],
    ['already_pending', 'pending'],
    ['transfer_pending', 'pending'],
    ['cancelled', 'cancelled'],
    ['expired', 'expired'],
    ['interrupted', 'recovery'],
    ['preparation_failed', 'preparationFailed'],
    ['acceptance_failed', 'acceptanceFailed'],
    ['continue_failed', 'continueFailed'],
  ] as const)
    if (message.includes(code)) return label;
  return 'failure';
}

/** Holds the short-lived code only in this panel's memory; never persists or logs it. */
export class NavigationTransferSession {
  private prepared: Prepared | null = null;
  private originalFence: string | null = null;
  private preparation: Preparation | null = null;
  private preparedOrigin: Preparation | null = null;
  private monotonicDeadline: number | null = null;
  private revision = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private view: View = { phase: 'idle', seconds: 0, error: null };
  constructor(
    private job: Job,
    private request: Request,
    private refresh: () => Promise<void>,
    private now: () => number = Date.now,
    private monotonic: () => number = () => performance.now(),
  ) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  private forget() {
    this.prepared = null;
    this.originalFence = null;
    this.preparation = null;
    this.preparedOrigin = null;
    this.monotonicDeadline = null;
  }
  mount() {
    this.disposed = false;
    this.revision++;
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.forget();
    this.view = { phase: 'idle', seconds: 0, error: null };
    this.listeners.clear();
  }
  update(job: Job, request = this.request, refresh = this.refresh) {
    this.request = request;
    this.refresh = refresh;
    if (this.view.phase === 'preparing' && this.preparation) {
      const frozen = expectedPending(job, this.preparation);
      const unchanged =
        !this.preparation.observedFrozen && jobFence(job) === this.preparation.fence;
      if (frozen) this.preparation.observedFrozen = true;
      else if (!unchanged) {
        this.revision++;
        this.forget();
        this.publish({ phase: 'stale', seconds: 0, error: null });
      }
    }
    if (this.prepared && this.preparedOrigin) {
      const frozen = expectedPending(job, this.preparedOrigin);
      const unchanged = !this.preparedOrigin.observedFrozen && jobFence(job) === this.originalFence;
      if (frozen) this.preparedOrigin.observedFrozen = true;
      else if (!unchanged) {
        this.revision++;
        this.forget();
        this.publish({ phase: 'stale', seconds: 0, error: null });
      }
    }
    this.job = job;
    this.publish({});
  }
  private remainingMilliseconds() {
    if (!this.prepared || this.monotonicDeadline === null) return 0;
    return Math.max(
      0,
      Math.min(this.prepared.expires_at_ms - this.now(), this.monotonicDeadline - this.monotonic()),
    );
  }
  get code(): string | null {
    return !this.disposed && this.prepared && this.remainingMilliseconds() > 0
      ? this.prepared.token
      : null;
  }
  get canPrepare() {
    return (
      !this.disposed &&
      !this.prepared &&
      !['preparing', 'cancelling'].includes(this.view.phase) &&
      canPrepareTransfer(this.job)
    );
  }
  get canCancel() {
    return (
      !this.disposed &&
      this.view.phase !== 'cancelling' &&
      validScope(this.job.navigation_scope) &&
      safeCounter(this.job.source_generation) &&
      (!!this.prepared || this.job.navigation_transfer_pending || this.view.phase === 'preparing')
    );
  }
  tick() {
    if (!this.prepared || this.disposed) return;
    const seconds = Math.ceil(this.remainingMilliseconds() / 1000);
    if (!seconds) {
      this.revision++;
      this.forget();
      this.publish({ phase: 'expired', seconds: 0, error: null });
      void this.refreshState();
    } else if (seconds !== this.view.seconds) this.publish({ seconds });
  }
  async refreshState() {
    try {
      await this.refresh();
    } catch {
      if (!this.disposed) this.publish({ error: 'failure' });
    }
  }
  async prepare() {
    if (!this.canPrepare) return;
    const input = structuredClone(this.job);
    const inputFence = jobFence(input);
    const operation = ++this.revision;
    this.forget();
    const preparation: Preparation = {
      input,
      fence: inputFence,
      expectedScope: {
        ...input.navigation_scope!,
        claim_generation: input.navigation_scope!.claim_generation + 1,
      },
      expectedSource: input.source_generation! + 1,
      monotonicLimit: this.monotonic() + CODE_LIFETIME_MS,
      observedFrozen: false,
    };
    this.preparation = preparation;
    this.publish({ phase: 'preparing', seconds: 0, error: null });
    try {
      const reply = await this.request({
        action: 'prepare',
        id: input.id,
        expected_scope: input.navigation_scope,
        expected_source_generation: input.source_generation,
        consent: true,
      });
      if (this.disposed || operation !== this.revision) return;
      if (!(
        expectedPending(this.job, preparation) ||
        (!preparation.observedFrozen && jobFence(this.job) === inputFence)
      )) {
        this.forget();
        this.publish({ phase: 'stale', seconds: 0, error: null });
        return;
      }
      const expectedScope = preparation.expectedScope;
      if (
        reply?.id !== input.id ||
        !validScope(reply.scope) ||
        scopeKey(reply.scope) !== scopeKey(expectedScope) ||
        reply.source_generation !== input.source_generation! + 1 ||
        typeof reply.token !== 'string' ||
        !reply.token.length ||
        reply.token.length > 4096 ||
        !Number.isSafeInteger(reply.expires_at_ms) ||
        reply.expires_at_ms <= this.now()
      ) {
        this.forget();
        this.publish({ phase: 'failed', error: 'preparationFailed' });
        return;
      }
      this.monotonicDeadline = Math.min(
        preparation.monotonicLimit,
        this.monotonic() + Math.min(CODE_LIFETIME_MS, reply.expires_at_ms - this.now()),
      );
      if (this.monotonicDeadline <= this.monotonic()) {
        this.forget();
        this.publish({ phase: 'expired', seconds: 0, error: null });
        return;
      }
      this.preparation = null;
      this.preparedOrigin = preparation;
      if (expectedPending(this.job, preparation)) this.preparedOrigin.observedFrozen = true;
      this.prepared = structuredClone(reply);
      this.originalFence = inputFence;
      this.publish({
        phase: 'ready',
        seconds: Math.ceil(this.remainingMilliseconds() / 1000),
        error: null,
      });
    } catch (error) {
      if (!this.disposed && operation === this.revision) {
        this.forget();
        this.publish({ phase: 'failed', error: errorLabel(error) });
      }
    } finally {
      await this.refreshState();
    }
  }
  async cancel() {
    if (!this.canCancel) return;
    const fence = this.prepared
      ? {
          id: this.prepared.id,
          scope: structuredClone(this.prepared.scope),
          source: this.prepared.source_generation,
        }
      : {
          id: this.job.id,
          scope: structuredClone(this.job.navigation_scope!),
          source: this.job.source_generation!,
        };
    const operation = ++this.revision;
    this.forget();
    this.publish({ phase: 'cancelling', seconds: 0, error: null });
    try {
      await this.request({
        action: 'cancel',
        id: fence.id,
        expected_scope: fence.scope,
        expected_source_generation: fence.source,
      });
      if (!this.disposed && operation === this.revision) this.publish({ phase: 'cancelled' });
    } catch (error) {
      if (!this.disposed && operation === this.revision)
        this.publish({ phase: 'failed', error: errorLabel(error) });
    } finally {
      await this.refreshState();
    }
  }
}

export function NavigationTransfer({ job, locale, request, refresh }: NavigationTransferProps) {
  const labels = transferLabels(locale);
  const id = useId();
  const [session] = useState(() => new NavigationTransferSession(job, request, refresh));
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [copyStatus, setCopyStatus] = useState<TransferLabel | null>(null);
  useLayoutEffect(() => {
    session.update(job, request, refresh);
  }, [session, job, request, refresh]);
  useEffect(() => {
    session.mount();
    const timer = setInterval(() => session.tick(), 250);
    return () => {
      clearInterval(timer);
      session.dispose();
    };
  }, [session]);
  useEffect(() => {
    setCopyStatus(null);
  }, [job.id, view.phase]);
  const code = session.code;
  const status: TransferLabel | null =
    view.phase === 'idle' ? null : view.phase === 'failed' ? view.error : view.phase;
  async function copy() {
    session.tick();
    const current = session.code;
    if (!current) return;
    try {
      const clipboard = await import('@tauri-apps/plugin-clipboard-manager');
      if (session.code !== current) return;
      await clipboard.writeText(current);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('copyFailed');
    }
  }
  return (
    <section
      aria-labelledby={id + '-title'}
      dir={locale.split('-')[0] === 'ar' ? 'rtl' : undefined}
    >
      <h3 id={id + '-title'}>{labels.title}</h3>
      <p>{labels.consent}</p>
      <p id={id + '-instructions'}>{labels.recipient}</p>
      <p>{labels.privacy}</p>
      {status && <p role="status">{labels[status]}</p>}
      {view.error && view.phase !== 'failed' && <p role="alert">{labels[view.error]}</p>}
      {job.navigation_transfer_pending && !code && <p role="status">{labels.pending}</p>}
      {job.navigation_transfer_recovery && <p role="status">{labels.recovery}</p>}
      {!session.canPrepare &&
        !code &&
        !job.navigation_transfer_pending &&
        view.phase === 'idle' && <p>{labels.unavailable}</p>}
      {code && (
        <div>
          <label htmlFor={id + '-code'}>{labels.code}</label>
          <input
            id={id + '-code'}
            value={code}
            readOnly
            autoComplete="off"
            spellCheck={false}
            aria-describedby={id + '-instructions'}
            onFocus={(event) => event.currentTarget.select()}
          />
          <output role="timer" aria-live="off">
            {labels.expires.replace('{seconds}', String(view.seconds))}
          </output>
          <button type="button" onClick={() => void copy()}>
            {labels.copy}
          </button>
          {copyStatus && <p role="status">{labels[copyStatus]}</p>}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" disabled={!session.canPrepare} onClick={() => void session.prepare()}>
          {labels.create}
        </button>
        <button type="button" disabled={!session.canCancel} onClick={() => void session.cancel()}>
          {labels.cancel}
        </button>
        <button type="button" onClick={() => void session.refreshState()}>
          {labels.refresh}
        </button>
      </div>
    </section>
  );
}
