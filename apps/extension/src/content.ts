import browser from 'webextension-polyfill';
import { translate } from '../../../packages/shared/src/i18n';
let locale = 'en',
  overlay = true;
const sources = new Set<string>();
let button: HTMLButtonElement | null = null;
async function init() {
  const { settings } = (await browser.storage.local.get('settings')) as {
    settings?: { locale?: string; overlay?: boolean };
  };
  locale = settings?.locale ?? 'en';
  overlay = settings?.overlay ?? true;
  observe();
}
function observe() {
  if (!document.documentElement) return;
  const update = () => {
    for (const element of document.querySelectorAll<HTMLMediaElement>('video,audio')) {
      const source = element.currentSrc || element.src;
      if (/^https?:\/\//.test(source)) sources.add(source);
    }
    if (overlay && document.querySelector('video,audio') && sources.size && !button) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483646';
      const root = host.attachShadow({ mode: 'closed' });
      button = document.createElement('button');
      button.textContent = translate(locale, 'downloadMedia');
      button.style.cssText =
        'font:13px system-ui;padding:10px 15px;border-radius:8px;border:1px solid #b6d5cc;background:#eef9f5;color:#145b4b;cursor:pointer;box-shadow:0 3px 15px #0002';
      button.addEventListener('click', async () => {
        const url = [...sources].find((s) => /m3u8|mpd/i.test(s)) ?? [...sources][0];
        if (!url) return;
        try {
          await browser.runtime.sendMessage({ type: 'download_media', url });
          button!.textContent = translate(locale, 'saved');
        } catch {
          button!.textContent = translate(locale, 'disconnected');
        }
      });
      root.append(button);
      document.documentElement.append(host);
    }
  };
  new MutationObserver(update).observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
  document.addEventListener('loadedmetadata', update, true);
  update();
  browser.runtime.onMessage.addListener((message: any) => {
    if (message.type === 'media_source') {
      if (/^https?:\/\//.test(message.url)) sources.add(message.url);
      update();
    }
    if (message.type === 'collect_links') {
      const selection = window.getSelection();
      return Promise.resolve(
        [
          ...new Set(
            [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
              .filter((a) => !message.selection || selection?.containsNode(a, true))
              .map((a) => a.href)
              .filter((url) => /^https?:\/\//.test(url)),
          ),
        ].slice(0, 1000),
      );
    }
    return undefined;
  });
}
void init();
