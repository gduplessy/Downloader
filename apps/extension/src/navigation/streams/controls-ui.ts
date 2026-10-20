import { captureText } from '../../../../../packages/shared/src/capture-ui';
import type { CaptureLane } from './readiness';
type Report = { browser: 'chromium' | 'firefox'; blob: CaptureLane; originalResponse: CaptureLane };
export function mountCaptureControls(
  parent: HTMLElement,
  locale: string,
  send: (message: any) => Promise<any>,
  site: () => string = () => '',
) {
  const doc = parent.ownerDocument;
  const section = doc.createElement('section');
  const heading = doc.createElement('h2');
  heading.textContent = captureText(locale, 'heading');
  const status = doc.createElement('div');
  status.setAttribute('aria-live', 'polite');
  const folder = doc.createElement('p');
  folder.setAttribute('role', 'status');
  const policy = doc.createElement('p');
  policy.textContent = captureText(locale, 'policy');
  const help = doc.createElement('p');
  help.textContent = captureText(locale, 'scopeHelp');
  const result = doc.createElement('p');
  result.setAttribute('role', 'status');
  const choose = doc.createElement('button');
  choose.type = 'button';
  choose.textContent = captureText(locale, 'choose');
  const refreshButton = doc.createElement('button');
  refreshButton.type = 'button';
  refreshButton.textContent = captureText(locale, 'refresh');
  choose.onclick = async () => {
    choose.disabled = true;
    try {
      const response = await send({ type: 'desktop_destination_setup' });
      result.textContent = captureText(
        locale,
        response?.status === 'queued' ? 'queued' : 'offline',
      );
    } catch {
      result.textContent = captureText(locale, 'offline');
    } finally {
      choose.disabled = false;
    }
  };
  async function refresh() {
    refreshButton.disabled = true;
    try {
      const [report, destination] = await Promise.all([
        send({ type: 'capture_readiness', url: site().trim() || undefined }) as Promise<Report>,
        send({ type: 'desktop_destination' }).catch(() => null),
      ]);
      status.replaceChildren();
      for (const [key, lane] of [
        ['blob', report.blob],
        ['response', report.originalResponse],
      ] as const) {
        const row = doc.createElement('p');
        row.textContent =
          captureText(
            locale,
            key === 'response' && report.browser === 'firefox' ? 'firefoxResponse' : key,
          ) +
          ': ' +
          captureText(locale, lane.reason);
        status.append(row);
      }
      if (report.browser === 'firefox') {
        const note = doc.createElement('p');
        note.textContent = captureText(locale, 'firefoxPending');
        status.append(note);
      }
      folder.textContent =
        typeof destination?.directory === 'string'
          ? captureText(locale, 'destination') + ': ' + destination.directory
          : captureText(locale, 'offline');
    } catch {
      status.replaceChildren();
      status.textContent = captureText(locale, 'offline');
      folder.textContent = captureText(locale, 'offline');
    } finally {
      refreshButton.disabled = false;
    }
  }
  refreshButton.onclick = () => void refresh();
  section.append(heading, status, help, folder, policy, choose, refreshButton, result);
  parent.append(section);
  return { refresh };
}
