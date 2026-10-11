import browser from 'webextension-polyfill';
import type { DurableWait } from './waits';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { schedulerText } from './labels';
export type QueueStatus = 'queued' | 'active' | 'waiting' | 'manual' | 'recovering' | 'paused' | 'finished';
export interface QueueTask { id: string; generation: number; owner: string; host_keys: string[]; priority: number; order: number; status: QueueStatus; reason: string; wait: DurableWait | null; lease: { owner: string; tab_id: number; generation: number; expires_at_ms: number } | null }
export interface QueueSnapshot { settings: { max_active: number; paused: boolean; notifications: boolean }; active: number; tasks: QueueTask[] }
export type NativeScheduler = (request: Record<string, unknown>) => Promise<QueueSnapshot>;
export const WAIT_ALARM_PREFIX = 'navigation-wait-';
export class NavigationScheduler {
  private snapshot: QueueSnapshot | null = null;
  private wakes = new Map<string, Promise<void>>();
  constructor(private native: NativeScheduler, private wake: (id: string) => Promise<void>) {}
  async request(request: Record<string, unknown>): Promise<QueueSnapshot> {
    this.snapshot = await this.native(request);
    return this.snapshot;
  }
  async admitted(id: string): Promise<boolean> {
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (!task) return false;
    const admitted = await this.request({ action: 'admit', id, generation: task.generation });
    return admitted.tasks.some(t => t.id === id && t.status === 'active' && !!t.lease);
  }
  async heartbeat(id: string, tabId: number) {
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (task?.lease) await this.request({ action: 'heartbeat', id, generation: task.generation, tab_id: tabId });
  }
  async reconcile(records: { id: string; tabId: number; origin?: string; private?: boolean; cookieStoreId?: string | null; scope?: SessionScope }[]) {
    const state = await this.request({ action: 'snapshot' });
    const live: { id: string; generation: number; tab_id: number; scope: SessionScope | null }[] = [];
    for (const record of records) {
      const task = state.tasks.find(t => t.id === record.id);
      const tab = await browser.tabs.get(record.tabId).catch(() => null);
      let matches = !!tab;
      if (tab && record.origin) {try {matches = !!tab.url && new URL(tab.url).origin === record.origin;} catch {matches = false;}}
      const expectedPrivate = record.scope?.private ?? record.private;
      const expectedStore = record.scope?.cookie_store_id ?? record.cookieStoreId;
      if (tab && expectedPrivate !== undefined && !!tab.incognito !== expectedPrivate) matches = false;
      if (tab && expectedStore && (tab as { cookieStoreId?: string }).cookieStoreId !== expectedStore) matches = false;
      if (task && tab && matches) live.push({ id: task.id, generation: task.generation, tab_id: record.tabId, scope: record.scope ?? null });
    }
    const restored = await this.request({ action: 'reconcile', live });
    for (const task of restored.tasks) if (task.wait && task.lease) await this.alarm(task);
    return restored;
  }
  async wait(id: string, wait: DurableWait) {
    const state = await this.request({ action: 'wait', id, generation: wait.source_generation, wait });
    const task = state.tasks.find(t => t.id === id);
    if (task) await this.alarm(task);
  }
  async readiness(id: string, ready: boolean): Promise<boolean> {
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (!task?.wait) return true;
    const result = await this.request({ action: 'ready', id, generation: task.generation, wait_generation: task.wait.generation, ready });
    const current = result.tasks.find(t => t.id === id);
    if (!ready || current?.status !== 'active') return false;
    await this.clearAlarms(id);
    // The service records notification emission atomically by wait generation.
    if (result.settings.notifications && current.wait && !current.wait.notified) {
      const claimed = await this.request({ action: 'notify', id, generation: current.generation, wait_generation: current.wait.generation });
      const notification = claimed.tasks.find(t => t.id === id);
      if (notification?.reason === 'ready_notification_claimed' && await browser.permissions.contains({ permissions: ['notifications'] })) {
        const stored = await browser.storage.local.get('settings');
        const locale = (stored.settings as { locale?: string } | undefined)?.locale ?? 'en';
        await browser.notifications.create('navigation-ready-' + id + '-' + current.wait.generation, { type: 'basic', iconUrl: browser.runtime.getURL('icon128.png'), title: 'Downloader', message: schedulerText(locale, 'ready') }).catch(() => {});
      }
    }
    return true;
  }
  async release(id: string) {
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (task) await this.request({ action: 'release', id, generation: task.generation });
    await this.clearAlarms(id);
  }
  private alarmName(task: QueueTask): string {
    return WAIT_ALARM_PREFIX + task.id + ':' + task.generation + ':' + task.wait!.generation;
  }
  private async clearAlarms(id: string) {
    const prefix = WAIT_ALARM_PREFIX + id;
    const alarms = await browser.alarms.getAll();
    await Promise.all(alarms.filter(alarm => alarm.name === prefix || alarm.name.startsWith(prefix + ':')).map(alarm => browser.alarms.clear(alarm.name)));
  }
  async observe(id: string) {
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (task?.wait) await this.onAlarm(this.alarmName(task));
  }
  async onAlarm(name: string) {
    if (!name.startsWith(WAIT_ALARM_PREFIX)) return false;
    const match = name.slice(WAIT_ALARM_PREFIX.length).match(/^(.*):(\d+):(\d+)$/);
    if (!match) return true;
    const [, id, sourceGeneration, waitGeneration] = match;
    const state = await this.request({ action: 'snapshot' });
    const task = state.tasks.find(t => t.id === id);
    if (task?.wait && task.lease && task.status === 'waiting' && task.generation === Number(sourceGeneration) && task.wait.generation === Number(waitGeneration)) {
      if (this.wakes.has(id)) return true;
      const wake = this.wake(id);
      this.wakes.set(id, wake);
      try { await wake; }
      finally {
        this.wakes.delete(id);
        const latest = await this.request({ action: 'snapshot' }).catch(() => state);
        const current = latest.tasks.find(t => t.id === id && t.status === 'waiting' && !!t.lease && !!t.wait);
        if (current) await browser.alarms.create(this.alarmName(current), { when: Date.now() + 30000 });
      }
    }
    return true;
  }
  private async alarm(task: QueueTask) {
    if (task.wait) {
      await this.clearAlarms(task.id);
      await browser.alarms.create(this.alarmName(task), { when: Math.max(Date.now() + 1000, task.wait.next_recheck_ms) });
    }
  }
}
