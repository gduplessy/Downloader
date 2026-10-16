import { mountSchedulerControls } from './navigation/scheduler/ui';
import { mountTransfer } from './navigation/session/transfer-ui';

import { streamTranslate, type StreamTextKey } from './navigation/streams/i18n';
import browser from 'webextension-polyfill';
declare const BROWSER: 'chromium' | 'firefox';
import { translate, languages, type Key } from '../../../packages/shared/src/i18n';
import { defaults, sitePattern } from './capture';
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
async function main() {
  let settings = {
    ...defaults,
    ...((await browser.storage.local.get('settings')) as Record<string, any>).settings,
  };
  function localize() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-stream-i18n]'))
      el.textContent = streamTranslate(settings.locale, el.dataset.streamI18n as StreamTextKey);
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]'))
      el.textContent = translate(settings.locale, el.dataset.i18n as Key);
    document.documentElement.dir = settings.locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = settings.locale;
  }
  const select = document.getElementById('locale') as HTMLSelectElement;
  for (const [key, name] of Object.entries(languages)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = name;
    select.append(option);
  }
  select.value = settings.locale;
  input('automatic').checked = settings.automatic;
  input('direct-capture').checked = settings.directCapture;
  input('overlay').checked = settings.overlay;
  input('extensions').value = settings.extensions.join(' ');
  input('excluded').value = settings.excluded.join('\n');
  document.getElementById('extension-id')!.textContent = browser.runtime.id;
  localize();
  const transfer = document.createElement('section');
  document.body.append(transfer);
  await mountTransfer(transfer, settings.locale).catch(error => { transfer.textContent = String(error); });
  const navigation = document.createElement('section');
  document.body.append(navigation);
  await mountSchedulerControls(navigation, settings.locale).catch((error) => {
    navigation.textContent = String(error);
  });
  select.onchange = () => {
    settings.locale = select.value;
    localize();
  };
  document.getElementById('enable')!.onclick = async () => {
    const chromium = BROWSER === 'chromium';
    const granted = await browser.permissions.request({
      permissions: [
        'cookies',
        'webRequest',
        ...(chromium ? ['scripting' as const, 'webNavigation' as const] : ['webRequestBlocking' as const]),
      ],
      origins: input('all-sites').checked
        ? ['http://*/*', 'https://*/*']
        : [sitePattern(input('site-scope').value)],
    });
    if (granted) {
      input('automatic').checked = true;
      await save();
    }
    document.getElementById('result')!.textContent = translate(
      settings.locale,
      granted ? 'saved' : 'disconnected',
    );
  };
  async function save() {
    settings = {
      ...settings,
      automatic: input('automatic').checked,
      directCapture: input('direct-capture').checked,
      overlay: input('overlay').checked,
      extensions: input('extensions').value.toLowerCase().split(/\s+/).filter(Boolean),
      excluded: input('excluded')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      locale: select.value,
    };
    await browser.storage.local.set({ settings });
    await browser.runtime.sendMessage({ type: 'settings_changed' });
    document.getElementById('result')!.textContent = translate(settings.locale, 'saved');
  }
  document.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    void save();
  };
  document.getElementById('test')!.onclick = async () => {
    try {
      const health = await browser.runtime.sendMessage({ type: 'diagnostics' });
      document.getElementById('result')!.textContent = JSON.stringify(health, null, 2);
    } catch (e) {
      document.getElementById('result')!.textContent = String(e);
    }
  };
}
void main();
