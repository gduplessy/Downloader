import { describe, it, expect, vi, beforeEach } from 'vitest';
const browser = vi.hoisted(() => ({
  cookies: { getAllCookieStores: vi.fn() },
  tabs: { get: vi.fn() }, alarms: { create: vi.fn(), clear: vi.fn(), getAll: vi.fn() },
  permissions: { contains: vi.fn() }, notifications: { create: vi.fn() }, runtime: { getURL: vi.fn() },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
import { NavigationScheduler } from './runtime';
import type { QueueSnapshot } from './runtime';
import { observeWait } from './waits';
const snapshot = (): QueueSnapshot => ({ settings: { max_active: 3, paused: false, notifications: true }, active: 1, tasks: [{ id: 'job', generation: 1, owner: 'profile', host_keys: [], priority: 0, order: 1, status: 'waiting', reason: 'waiting_server_readiness', lease: { owner: 'profile', generation: 1, tab_id: 7, expires_at_ms: 90000 }, wait: observeWait(undefined, 1, 60000, 0, 'countdown') }] });
beforeEach(() => { vi.resetAllMocks(); browser.alarms.create.mockResolvedValue(undefined); browser.alarms.clear.mockResolvedValue(true); browser.alarms.getAll.mockResolvedValue([{ name: 'navigation-wait-job:1:1' }]); });
describe('durable browser alarm recovery', () => {
 it('reconciles Chromium tabs using actual cookie-store membership', async () => {
   const scope = { browser: 'chromium' as const, profile: 'profile', private: false,
     cookie_store_id: '0', container_id: null, partition_key: null, claim_generation: 2 };
   const native = vi.fn().mockResolvedValue(snapshot());
   browser.tabs.get.mockResolvedValue({id: 7, incognito: false});
   browser.cookies.getAllCookieStores.mockResolvedValue([{id: '0', tabIds: [7]}]);
   const scheduler = new NavigationScheduler(native, vi.fn());
   await scheduler.reconcile([{id: 'job', tabId: 7, scope}]);
   expect(native).toHaveBeenLastCalledWith({action: 'reconcile', live: [{id: 'job', generation: 1, tab_id: 7, scope}]});
   browser.cookies.getAllCookieStores.mockResolvedValue([{id: '1', tabIds: [7]}]);
   await scheduler.reconcile([{id: 'job', tabId: 7, scope}]);
   expect(native).toHaveBeenLastCalledWith({action: 'reconcile', live: []});
   browser.cookies.getAllCookieStores.mockRejectedValue(Error('permission denied'));
   await scheduler.reconcile([{id: 'job', tabId: 7, scope}]);
   expect(native).toHaveBeenLastCalledWith({action: 'reconcile', live: []});
 });
 it('reconciles actual live tabs after restart and recreates alarms', async () => {
   const state = snapshot(); browser.tabs.get.mockResolvedValue({ id: 7 }); const native = vi.fn().mockResolvedValue(state);
   const scheduler = new NavigationScheduler(native, vi.fn()); await scheduler.reconcile([{ id: 'job', tabId: 7 }]);
   expect(native).toHaveBeenCalledWith({ action: 'reconcile', live: [{ id: 'job', generation: 1, tab_id: 7, scope: null }] });
   expect(browser.alarms.create).toHaveBeenCalledWith('navigation-wait-job:1:1', expect.any(Object));
 });
 it('forwards the exact claim and rejects a tab in another container', async () => {
   const scope = {
     browser: 'firefox' as const, profile: 'profile', private: false,
     cookie_store_id: 'firefox-container-1', container_id: '1', partition_key: null,
     claim_generation: 2,
   };
   const native = vi.fn().mockResolvedValue(snapshot());
   browser.tabs.get.mockResolvedValue({id: 7, incognito: false, cookieStoreId: 'firefox-container-1'});
   const scheduler = new NavigationScheduler(native, vi.fn());
   await scheduler.reconcile([{id: 'job', tabId: 7, scope}]);
   expect(native).toHaveBeenCalledWith({action: 'reconcile', live: [{id: 'job', generation: 1, tab_id: 7, scope}]});
   browser.tabs.get.mockResolvedValue({id: 7, incognito: false, cookieStoreId: 'firefox-container-2'});
   await scheduler.reconcile([{id: 'job', tabId: 7, scope}]);
   expect(native).toHaveBeenLastCalledWith({action: 'reconcile', live: []});
 });
 it('missing tab is reported absent rather than recreating another session', async () => {
   browser.tabs.get.mockRejectedValue(Error('tab missing')); const native = vi.fn().mockResolvedValue(snapshot());
   await new NavigationScheduler(native, vi.fn()).reconcile([{ id: 'job', tabId: 7 }]);
   expect(native).toHaveBeenCalledWith({ action: 'reconcile', live: [] });
 });
 it('late/repeated alarms only request fresh observation and arm bounded retry', async () => {
   const wake = vi.fn().mockResolvedValue(undefined); const native = vi.fn().mockResolvedValue(snapshot());
   const scheduler = new NavigationScheduler(native, wake); await scheduler.onAlarm('navigation-wait-job:1:1'); await scheduler.onAlarm('navigation-wait-job:1:1');
   expect(wake).toHaveBeenCalledTimes(2); expect(native.mock.calls.every(call => (call[0] as Record<string, unknown>).action === 'snapshot')).toBe(true);
   expect(browser.alarms.create).toHaveBeenCalledTimes(2);
 });
 it('stale source and replaced wait alarms cannot wake current actions', async () => {
   const state = snapshot(); state.tasks[0].wait!.generation = 2;
   const wake = vi.fn(); const scheduler = new NavigationScheduler(vi.fn().mockResolvedValue(state), wake);
   await scheduler.onAlarm('navigation-wait-job:1:1'); await scheduler.onAlarm('navigation-wait-job:0:2');
   expect(wake).not.toHaveBeenCalled(); expect(browser.alarms.create).not.toHaveBeenCalled();
   await scheduler.onAlarm('navigation-wait-job:1:2'); expect(wake).toHaveBeenCalledOnce();
 });
 it('server refusal cannot become readiness despite elapsed deadline', async () => {
   const native = vi.fn().mockResolvedValue(snapshot()); const scheduler = new NavigationScheduler(native, vi.fn());
   expect(await scheduler.readiness('job', false)).toBe(false); expect(browser.notifications.create).not.toHaveBeenCalled();
 });
 it('denied notification permission leaves confirmed readiness usable', async () => {
   const state = snapshot(); const native = vi.fn(async (r: Record<string, unknown>) => {
     if (r.action === 'ready') state.tasks[0].status = 'active';
     if (r.action === 'notify') {state.tasks[0].reason = 'ready_notification_claimed'; state.tasks[0].wait!.notified = true;}
     return state;
   }); browser.permissions.contains.mockResolvedValue(false);
   expect(await new NavigationScheduler(native, vi.fn()).readiness('job', true)).toBe(true);
   expect(browser.notifications.create).not.toHaveBeenCalled(); expect(browser.alarms.clear).toHaveBeenCalledWith('navigation-wait-job:1:1');
 });
 it('cancellation clears alarms and releases service reservation', async () => {
   const native = vi.fn().mockResolvedValue(snapshot()); await new NavigationScheduler(native, vi.fn()).release('job');
   expect(native).toHaveBeenCalledWith({ action: 'release', id: 'job', generation: 1 }); expect(browser.alarms.clear).toHaveBeenCalledWith('navigation-wait-job:1:1');
 });
});
