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
  forget(key: string) { this.starts.delete(key); }
}
export function observeWait(previous: DurableWait | undefined, sourceGeneration: number, durationMs: number, now: number, fingerprint: string): DurableWait {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 604800000) throw Error('Invalid wait duration');
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
export function retryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  const deadline = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(value);
  return Number.isSafeInteger(deadline) && deadline >= now && deadline - now <= 604800000 ? deadline : null;
}

export async function waitFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.slice(0, 4096)));
  return 'wait:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
