export interface Download {
  id: number;
  url: string;
  finalUrl?: string;
  filename: string;
  state: string;
  incognito?: boolean;
}
export function sitePattern(source: string): string {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('Enter an HTTP or HTTPS site URL');
  return url.protocol + '//' + url.hostname + '/*';
}
export interface CaptureSettings {
  automatic: boolean;
  extensions: string[];
  excluded: string[];
  bypassUntil: number;
  locale: string;
  overlay: boolean;
}
export const defaults: CaptureSettings = {
  automatic: false,
  extensions: [
    'zip',
    '7z',
    'rar',
    'exe',
    'msi',
    'dmg',
    'deb',
    'pdf',
    'epub',
    'mp4',
    'mkv',
    'webm',
    'mp3',
    'flac',
    'iso',
  ],
  excluded: [],
  bypassUntil: 0,
  locale: 'en',
  overlay: true,
};
export function excluded(url: string, rules: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return rules.some((rule) => {
    rule = rule.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('*.')) return host === rule.slice(2) || host.endsWith('.' + rule.slice(2));
    return host === rule;
  });
}
export function eligible(item: Download, settings: CaptureSettings, method?: string): boolean {
  if (
    !settings.automatic ||
    Date.now() < settings.bypassUntil ||
    item.state !== 'in_progress' ||
    method !== 'GET'
  )
    return false;
  const url = item.finalUrl || item.url;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  } catch {
    return false;
  }
  if (excluded(url, settings.excluded) || excluded(item.url, settings.excluded)) return false;
  const ext = item.filename.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  return Boolean(ext && settings.extensions.includes(ext));
}
export type NativeJob = { id: string; state: string; viable: boolean };
export interface HandoffAdapter {
  pause(id: number): Promise<void>;
  resume(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
  create(requestId: string): Promise<NativeJob>;
  job(id: string): Promise<NativeJob | undefined>;
  cancelNative(id: string): Promise<void>;
  pending(value: { downloadId: number; requestId: string; jobId?: string } | null): Promise<void>;
  wait(ms: number): Promise<void>;
  deadline?: number;
}
export async function handoff(
  item: Download,
  adapter: HandoffAdapter,
): Promise<'desktop' | 'browser'> {
  const requestId = 'browser-' + item.id + '-' + crypto.randomUUID();
  let paused = false,
    job: NativeJob | undefined;
  try {
    await adapter.pending({ downloadId: item.id, requestId });
    await adapter.pause(item.id);
    paused = true;
    job = await adapter.create(requestId);
    await adapter.pending({ downloadId: item.id, requestId, jobId: job.id });
    for (let elapsed = 0; elapsed < (adapter.deadline ?? 10000); elapsed += 200) {
      if (job?.viable || job?.state === 'complete') {
        await adapter.cancel(item.id);
        await adapter.pending(null);
        return 'desktop';
      }
      if (
        !job ||
        ['failed', 'cancelled', 'waiting_authentication', 'waiting_source'].includes(job.state)
      )
        break;
      await adapter.wait(200);
      job = await adapter.job(job.id);
    }
  } catch {
  } finally {
    // The pending record is kept until either cancellation or fallback succeeds.
  }
  if (job) {
    try {
      await adapter.cancelNative(job.id);
    } catch {}
  }
  if (paused) {
    await adapter.resume(item.id);
  }
  await adapter.pending(null);
  return 'browser';
}
