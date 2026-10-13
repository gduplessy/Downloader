import { mountDiscovery } from './navigation/discovery/ui';
import browser from 'webextension-polyfill';
import { streamTranslate, type StreamTextKey } from './navigation/streams/i18n';
import { translate, type Key } from '../../../packages/shared/src/i18n';
const element = (id: string) => document.getElementById(id)!;
let pendingURL = '';
let refreshJob: any = null;
let solverJob: any = null;
async function main() {
  const { settings, lastError } = (await browser.storage.local.get(['settings', 'lastError'])) as {
    settings?: { locale?: string };
    lastError?: string;
  };
  const locale = settings?.locale ?? 'en';
  void mountDiscovery(document.body, locale);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]'))
    el.textContent = translate(locale, el.dataset.i18n as Key);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  element('refresh-session').onclick = () => {
    const url = window.prompt(translate(locale, 'url'), refreshJob?.url ?? '');
    if (url)
      void browser.runtime
        .sendMessage({ type: 'refresh_session', id: refreshJob.id, url })
        .then(() => window.close())
        .catch((e) => {
          element('error').textContent = String(e);
        });
  };
  element('options').onclick = () => void browser.runtime.openOptionsPage();
  element('try-solver').onclick = () =>
    void browser.runtime
      .sendMessage({ type: 'try_solver', id: solverJob.id })
      .then(() => window.close())
      .catch((e) => {
        element('error').textContent = String(e);
      });
  element('bypass').onclick = () =>
    void browser.runtime.sendMessage({ type: 'bypass' }).then(() => window.close());
  element('continue-navigation').onclick = () =>
    void browser.runtime
      .sendMessage({ type: 'continue_navigation', url: pendingURL })
      .then(() => window.close())
      .catch((e) => {
        element('error').textContent = String(e);
      });
  try {
    const snapshot: any = await browser.runtime.sendMessage({
      type: 'snapshot',
    });
    const captures: any[] = await browser.runtime.sendMessage({ type: 'capture_status' });
    const capture =
      captures.find((c) => ['armed', 'taking_original_response', 'streaming'].includes(c.state)) ??
      captures.at(-1);
    if (capture) {
      element('capture-state').textContent = streamTranslate(
        locale,
        capture.state as StreamTextKey,
      );
      const cancel = element('cancel-capture') as HTMLButtonElement;
      cancel.textContent = streamTranslate(locale, 'cancel');
      cancel.hidden = !['armed', 'taking_original_response', 'streaming'].includes(capture.state);
      cancel.onclick = () =>
        void browser.runtime
          .sendMessage({ type: 'cancel_capture', id: capture.id })
          .then(() => window.close())
          .catch((e) => (element('error').textContent = String(e)));
    }
    refreshJob = snapshot.jobs.find((j: any) =>
      ['waiting_authentication', 'waiting_source'].includes(j.state),
    );
    (element('refresh-session') as HTMLButtonElement).disabled = !refreshJob;
    pendingURL =
      snapshot.jobs.find(
        (j: any) => j.page_url && ['waiting_browser', 'waiting_user'].includes(j.state),
      )?.page_url ?? '';
    (element('continue-navigation') as HTMLButtonElement).disabled = !pendingURL;
    solverJob = snapshot.jobs.find(
      (j: any) => j.page_url && ['waiting_browser', 'waiting_user'].includes(j.state),
    );
    (element('try-solver') as HTMLButtonElement).disabled =
      !solverJob || !snapshot.solver_enabled || !snapshot.solver_direct;
    element('connection').textContent = translate(locale, 'connected');
    element('connection').classList.add('good');
    element('active').textContent = String(
      snapshot.jobs.filter((j: any) =>
        [
          'solving_challenge',
          'connecting',
          'downloading',
          'assembling',
          'verifying',
          'scanning',
        ].includes(j.state),
      ).length,
    );
    element('complete').textContent = String(
      snapshot.jobs.filter((j: any) => j.state === 'complete').length,
    );
  } catch (e) {
    element('connection').textContent = translate(locale, 'disconnected');
    element('error').textContent = String(lastError ?? e);
  }
}
void main();
