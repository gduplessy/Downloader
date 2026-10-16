/** UTC is durable; monotonic time guards live-process clock changes. A due wait
 * only permits another observation, never submission or fabricated readiness. */
export interface DurableWait {
  generation: number;
  source_generation: number;
  observed_at_ms: number;
  observed_duration_ms: number;
  deadline_ms: number;
  next_recheck_ms: number;
  basis: 'server' | 'page';
  requires_live_tab: boolean;
  expires_at_ms: number | null;
  reason: string;
  notified: boolean;
}
export interface Clock { utc(): number; monotonic(): number }
export class WaitClock {
  private starts = new Map<string, { utc: number; monotonic: number }>();
  constructor(private clock: Clock) {}
  elapsed(key: string, wait: DurableWait): number {
    let start = this.starts.get(key);
    if (!start) {
      start = { utc: this.clock.utc(), monotonic: this.clock.monotonic() };
      this.starts.set(key, start);
    }
    const recovered = Math.max(0, start.utc - wait.observed_at_ms);
    return recovered + Math.max(0, this.clock.monotonic() - start.monotonic);
  }
  due(key: string, wait: DurableWait): boolean {
    return this.recheckDelay(key, wait) === 0;
  }
  recheckDelay(key: string, wait: DurableWait): number {
    const interval = Math.max(0, Math.min(wait.observed_duration_ms || 30000,
      wait.next_recheck_ms - wait.observed_at_ms));
    return Math.max(0, interval - this.elapsed(key, wait));
  }
  remaining(key: string, wait: DurableWait): number {
    return Math.max(0, wait.observed_duration_ms - this.elapsed(key, wait));
  }
  forget(key: string) { this.starts.delete(key); }
}
export function observeWait(previous: DurableWait | undefined, sourceGeneration: number, durationMs: number, now: number, fingerprint: string): DurableWait {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 604800000) throw Error('Invalid wait duration');
  // A page countdown cannot replace a bound server deadline.
  if (previous?.basis === 'server' && previous.source_generation === sourceGeneration) return previous;
  // Only persist an opaque hash/fixed adapter reason, never page text or token.
  const reason = fingerprint.slice(0, 256);
  if (previous?.source_generation === sourceGeneration && previous.reason === reason && previous.deadline_ms >= now && Math.abs(previous.deadline_ms - (now + durationMs)) < 2000) return previous;
  return { generation: (previous?.generation ?? 0) + 1, source_generation: sourceGeneration,
    observed_at_ms: now, observed_duration_ms: durationMs, deadline_ms: now + durationMs,
    next_recheck_ms: now + Math.min(durationMs || 30000, 30000), basis: 'page', requires_live_tab: true,
    expires_at_ms: null, reason, notified: false };
}
export function activeBudgetElapsed(started: number, now: number, waits: readonly { start: number; end: number }[]): number {
  return Math.max(0, now - started - waits.reduce((total, wait) => total + Math.max(0, Math.min(now, wait.end) - Math.max(started, wait.start)), 0));
}
export function observeServerWait(
  previous: DurableWait | undefined,
  sourceGeneration: number,
  deadline: number,
  observedAt: number,
  responseIdentity = 'retry_after',
): DurableWait {
  const duration = deadline - observedAt;
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > 604800000)
    throw Error('Invalid server wait');
  const reason = responseIdentity === 'retry_after' ? responseIdentity : 'retry_after:' + responseIdentity;
  if (previous?.basis === 'server' && previous.source_generation === sourceGeneration
    && (previous.reason === reason || deadline <= previous.deadline_ms)) return previous;
  return {
    generation: (previous?.generation ?? 0) + 1,
    source_generation: sourceGeneration,
    observed_at_ms: observedAt,
    observed_duration_ms: duration,
    deadline_ms: deadline,
    next_recheck_ms: observedAt + Math.min(duration || 30000, 30000),
    basis: 'server',
    requires_live_tab: true,
    expires_at_ms: null,
    reason,
    notified: false,
  };
}
export function retryAfter(value: string | null, now: number): number | null {
  if (!value || value.length > 128 || /[\r\n]/.test(value)) return null;
  value = value.trim();
  let deadline: number;
  if (/^\d+$/.test(value)) deadline = now + Number(value) * 1000;
  else {
    if (
      !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
        value,
      )
    )
      return null;
    deadline = Date.parse(value);
    if (!Number.isFinite(deadline) || new Date(deadline).toUTCString() !== value) return null;
  }
  return Number.isSafeInteger(deadline) && deadline >= now && deadline - now <= 604800000
    ? deadline
    : null;
}

export async function waitFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.slice(0, 4096)));
  return 'wait:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
