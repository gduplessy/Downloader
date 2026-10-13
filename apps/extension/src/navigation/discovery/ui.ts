import browser from 'webextension-polyfill';
import { translate, type Key } from '../../../../../packages/shared/src/i18n';
export async function mountDiscovery(container: HTMLElement, locale: string) {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = translate(locale, 'discoveryProjects');
  section.append(title);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  section.append(status);
  container.append(section);
  if (!(await browser.permissions.contains({ permissions: ['cookies'] }))) {
    const connect = document.createElement('button');
    connect.textContent = translate(locale, 'discoveryStart');
    connect.onclick = () =>
      void browser.permissions
        .request({
          permissions: [
            'cookies',
            'tabs',
            ...(typeof (browser as any).scripting === 'object' ? ['scripting' as const] : []),
          ],
        })
        .then((granted) => {
          if (granted) {
            section.remove();
            void mountDiscovery(container, locale);
          }
        });
    section.append(connect);
    return;
  }
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return;
    const projects = await browser.runtime.sendMessage({ type: 'discovery_projects', tabId });
    for (const project of projects as { id: string; url: string; status: string }[]) {
      const row = document.createElement('div');
      const name = document.createElement('p');
      name.textContent = new URL(project.url).host + ' · ' + project.status;
      row.append(name);
      const origins = document.createElement('input');
      origins.type = 'text';
      origins.setAttribute('aria-label', translate(locale, 'discoveryCrossOrigins'));
      origins.placeholder = translate(locale, 'discoveryCrossOrigins');
      row.append(origins);
      const start = document.createElement('button');
      start.textContent = translate(locale, 'discoveryStart');
      start.onclick = () =>
        void (async () => {
          try {
            const permitted = origins.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((value) => new URL(value).origin);
            const granted = await browser.permissions.request({
              permissions: [
                'cookies',
                ...(typeof (browser as any).scripting === 'object' ? ['scripting' as const] : []),
              ],
              origins: [
                new URL(project.url).origin + '/*',
                ...permitted.map((origin) => origin + '/*'),
              ],
            });
            if (!granted) throw Error('Discovery origin permission denied');
            await browser.runtime.sendMessage({
              type: 'discovery_start',
              id: project.id,
              tabId,
              permittedOrigins: permitted,
            });
            status.textContent = translate(locale, 'working');
          } catch (error) {
            status.textContent = String(error);
          }
        })();
      row.append(start);
      section.append(row);
    }
  } catch (error) {
    status.textContent = String(error);
  }
}
