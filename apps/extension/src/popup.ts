import browser from 'webextension-polyfill';
import { translate, type Key } from '../../../packages/shared/src/i18n';
const element = (id: string) => document.getElementById(id)!;
let pendingURL = '';
async function main() {
  const { settings, lastError } = (await browser.storage.local.get(['settings', 'lastError'])) as {
    settings?: { locale?: string };
    lastError?: string;
  };
  const locale = settings?.locale ?? 'en';
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]'))
    el.textContent = translate(locale, el.dataset.i18n as Key);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  element('options').onclick = () => void browser.runtime.openOptionsPage();
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
    pendingURL =
      snapshot.jobs.find(
        (j: any) => j.page_url && ['waiting_browser', 'waiting_user'].includes(j.state),
      )?.page_url ?? '';
    (element('continue-navigation') as HTMLButtonElement).disabled = !pendingURL;
    element('connection').textContent = translate(locale, 'connected');
    element('connection').classList.add('good');
    element('active').textContent = String(
      snapshot.jobs.filter((j: any) =>
        ['connecting', 'downloading', 'assembling', 'verifying', 'scanning'].includes(j.state),
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
