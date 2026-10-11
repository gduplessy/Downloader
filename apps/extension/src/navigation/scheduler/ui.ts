import browser from 'webextension-polyfill';
import { schedulerText } from './labels';
import type { QueueSnapshot } from './runtime';
export async function mountSchedulerControls(container: HTMLElement, locale: string) {
  const t = (key: string) => schedulerText(locale, key);
  const heading = document.createElement('h2'); heading.textContent = t('title'); container.append(heading);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); container.append(status);
  const limitLabel = document.createElement('label'); limitLabel.textContent = t('limit');
  const limit = document.createElement('input'); limit.type = 'number'; limit.min = '1'; limit.max = '20'; limit.step = '1'; limit.id = 'navigation-limit'; limitLabel.htmlFor = limit.id; container.append(limitLabel, limit);
  const notifyLabel = document.createElement('label'); const notifications = document.createElement('input'); notifications.type = 'checkbox'; notifyLabel.append(notifications, document.createTextNode(t('notifications'))); container.append(notifyLabel);
  const save = document.createElement('button'); save.type = 'button'; save.textContent = t('save'); container.append(save);
  const pause = document.createElement('button'); pause.type = 'button'; container.append(pause);
  const tasks = document.createElement('ol'); container.append(tasks);
  let snapshot: QueueSnapshot;
  const request = async (request: Record<string, unknown>) => browser.runtime.sendMessage({ type: 'navigation_scheduler', request }) as Promise<QueueSnapshot>;
  const safe = async (work: () => Promise<unknown>) => { try { await work(); await refresh(); } catch (error) { status.textContent = String(error); } };
  save.onclick = () => void safe(async () => {
    const value = Number(limit.value);
    if (!Number.isInteger(value) || value < 1 || value > 20) { limit.reportValidity(); throw Error(t('limit')); }
    if (notifications.checked && !(await browser.permissions.request({ permissions: ['notifications'] }))) notifications.checked = false;
    await request({ action: 'settings', max_active: value, notifications: notifications.checked });
  });
  pause.onclick = () => void safe(() => request({ action: 'control', id: null, paused: !snapshot.settings.paused, priority: null }));
  async function refresh() {
    snapshot = await request({ action: 'snapshot' });
    status.textContent = t('active') + ': ' + snapshot.active + ' / ' + snapshot.settings.max_active;
    if (!container.contains(document.activeElement) || document.activeElement === save) {limit.value = String(snapshot.settings.max_active); notifications.checked = snapshot.settings.notifications;}
    pause.textContent = t(snapshot.settings.paused ? 'resume' : 'paused');
    tasks.replaceChildren();
    for (const task of snapshot.tasks.filter(t => t.status !== 'finished')) {
      const row = document.createElement('li');
      const text = document.createElement('p'); text.textContent = task.id.slice(0, 8) + ' — ' + t(task.reason === 'browser_input_required' ? 'continue' : task.reason === 'active' ? 'activeState' : task.reason === 'ready_notification_claimed' ? 'ready_confirmed' : task.reason);
      if (task.wait) text.append(document.createTextNode(' · ' + new Date(task.wait.deadline_ms).toLocaleString(locale)));
      row.append(text);
      const priority = document.createElement('input'); priority.type = 'number'; priority.min = '-100'; priority.max = '100'; priority.value = String(task.priority); priority.setAttribute('aria-label', t('priority'));
      priority.onchange = () => void safe(() => request({ action: 'control', id: task.id, priority: Number(priority.value), paused: null })); row.append(priority);
      const button = (key: string, action: () => Promise<unknown>) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t(key); b.onclick = () => void safe(action); row.append(b); };
      if (['manual', 'paused', 'queued', 'waiting'].includes(task.status)) button('continue', () => browser.runtime.sendMessage({ type: 'navigation_queue_continue', id: task.id }));
      if (task.status === 'queued') button('pause', () => request({ action: 'control', id: task.id, paused: true, priority: null }));
      button('cancel', () => browser.runtime.sendMessage({ type: 'navigation_queue_cancel', id: task.id }));
      tasks.append(row);
    }
  }
  await refresh();
  const interval = setInterval(() => { if (!container.contains(document.activeElement)) void refresh().catch(e => { status.textContent = String(e); }); }, 5000);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
}
