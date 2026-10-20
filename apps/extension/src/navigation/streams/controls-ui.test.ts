import { expect, it } from 'vitest';
import { mountCaptureControls } from './controls-ui';
class Element {
  children: Element[] = [];
  textContent = '';
  disabled = false;
  type = '';
  onclick?: () => Promise<void> | void;
  ownerDocument = { createElement: () => new Element() };
  setAttribute() {}
  append(...items: Element[]) {
    this.children.push(...items);
  }
  replaceChildren() {
    this.children = [];
    this.textContent = '';
  }
}
const lane = { supported: true, enabled: true, ready: true, reason: 'ready' };
it('reads readiness for the requested site and requests only a fixed desktop setup action', async () => {
  const root = new Element();
  const messages: any[] = [];
  const controls = mountCaptureControls(
    root as unknown as HTMLElement,
    'en',
    async (message) => {
      messages.push(message);
      if (message.type === 'capture_readiness')
        return { browser: 'firefox', blob: lane, originalResponse: lane };
      if (message.type === 'desktop_destination') return { directory: 'C:/Downloads' };
      return { status: 'queued' };
    },
    () => ' https://fixture.test/file ',
  );
  await controls.refresh();
  const section = root.children[0];
  expect(messages[0]).toEqual({ type: 'capture_readiness', url: 'https://fixture.test/file' });
  expect(section.children[1].children).toHaveLength(3);
  expect(section.children[3].textContent).toContain('C:/Downloads');
  await section.children[5].onclick!();
  expect(messages.at(-1)).toEqual({ type: 'desktop_destination_setup' });
  expect(section.children[7].textContent).toContain('queued');
  expect(section.children[5].disabled).toBe(false);
});
it('keeps setup failures visible and restores keyboard controls', async () => {
  const root = new Element();
  const controls = mountCaptureControls(root as unknown as HTMLElement, 'fr', async () => {
    throw Error('offline');
  });
  await controls.refresh();
  const section = root.children[0];
  expect(section.children[1].textContent.length).toBeGreaterThan(0);
  await section.children[5].onclick!();
  expect(section.children[7].textContent).toEqual(section.children[1].textContent);
  expect(section.children[5].disabled).toBe(false);
  expect(section.children[6].disabled).toBe(false);
});

it('clears stale destination and readiness when a later refresh fails', async () => {
  const root = new Element();
  let offline = false;
  const controls = mountCaptureControls(root as unknown as HTMLElement, 'en', async (message) => {
    if (offline) throw Error('offline');
    return message.type === 'capture_readiness'
      ? { browser: 'chromium', blob: lane, originalResponse: lane }
      : { directory: '/previous' };
  });
  await controls.refresh();
  offline = true;
  await controls.refresh();
  const section = root.children[0];
  expect(section.children[1].children).toHaveLength(0);
  expect(section.children[3].textContent).not.toContain('/previous');
  expect(section.children[3].textContent).toEqual(section.children[1].textContent);
});
