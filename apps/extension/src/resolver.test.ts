import { beforeEach, expect, it, vi } from 'vitest';
import type { Control } from './navigation/adapters/policy';

const fixture = vi.hoisted(() => ({
  send: vi.fn(),
  listener: vi.fn(),
  controls: [] as Control[],
  elements: new Map<string, HTMLElement>(),
  preview: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: fixture.send, onMessage: { addListener: fixture.listener } } },
}));
vi.mock('./navigation/adapters/dom', async (original) => ({
  ...(await original<typeof import('./navigation/adapters/dom')>()),
  collectControls: () => ({
    controls: fixture.controls,
    elements: fixture.elements,
    secretsFingerprint: '',
  }),
  domFingerprint: async () => 'opaque-fixture-fingerprint',
}));
vi.mock('./navigation/adapters/selection-ui', () => ({ showPreview: fixture.preview }));

const scope = {
  browser: 'chromium',
  profile: 'b97c5662-21f5-4ae8-92e8-7d119c348ac0',
  private: false,
  cookie_store_id: null,
  container_id: null,
  partition_key: null,
  claim_generation: 1,
};
const context = { tabId: 7, frameId: 0, scope, locale: 'en' };
let timers: Element[];
let documentFixture: Document;
function timer(
  text: string,
  options: { hidden?: boolean; disabled?: boolean; attribute?: string; expiry?: string } = {},
) {
  return {
    textContent: text,
    ownerDocument: documentFixture,
    closest: () => null,
    getBoundingClientRect: () => ({ width: options.hidden ? 0 : 100, height: 20 }),
    getAttribute: (name: string) =>
      name === 'data-countdown'
        ? (options.attribute ?? null)
        : name === 'data-expires-at'
          ? (options.expiry ?? null)
          : null,
    matches: (selector: string) =>
      options.disabled
        ? selector.startsWith('button:disabled')
        : selector.startsWith('[class*="countdown"]'),
  } as unknown as Element;
}
function control(id: string) {
  const click = vi.fn();
  const href = 'http://127.0.0.1/file.bin';
  const element = {
    click,
    scrollIntoView: vi.fn(),
    style: { outline: '' },
    tagName: 'A',
    href,
  } as unknown as HTMLElement;
  fixture.elements.set(id, element);
  fixture.controls.push({
    localId: id,
    text: 'Download',
    href,
    target: href,
    action: 'link',
    visible: true,
    disabled: false,
    download: true,
    order: fixture.controls.length,
  });
  return click;
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  fixture.controls = [];
  fixture.elements = new Map();
  timers = [];
  documentFixture = {
    body: { innerText: '' },
    defaultView: { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
    querySelectorAll: () => timers,
  } as unknown as Document;
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('location', { href: 'http://127.0.0.1/nav-adapters/g4u/wait' });
  delete (globalThis as { __downloaderResolver?: boolean }).__downloaderResolver;
  fixture.send.mockImplementation(async (message) =>
    message.type === 'resolver_context' ? context : { click: false },
  );
  fixture.preview.mockReturnValue({ close: vi.fn() });
});

it.each([true, false])(
  'keeps scheduler wait metadata and blocks submission with owned context=%s',
  async (owned) => {
    const click = control('file');
    const expiry = Date.now() + 120000;
    timers = [
      timer('1:30', { expiry: new Date(expiry).toISOString() }),
      timer('900', { hidden: true }),
    ];
    fixture.send.mockImplementation(async (message) =>
      message.type === 'resolver_context' ? (owned ? context : null) : { click: false },
    );
    await import('./resolver');
    await vi.waitFor(() =>
      expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'resolver_step' })),
    );
    const message = fixture.send.mock.calls.find(([value]) => value.type === 'resolver_step')![0];
    expect(message.decision).toMatchObject({
      kind: 'wait',
      blocker: 'countdown',
      wait: { duration_ms: 90000, expires_at_ms: expiry },
    });
    expect(message.decision.wait.fingerprint).toMatch(/^countdown:/);
    expect(click).not.toHaveBeenCalled();
    expect(fixture.preview).not.toHaveBeenCalled();
  },
);

it('treats disabled download countdown attributes as waits through the merged resolver', async () => {
  const click = control('file');
  timers = [timer('Download', { disabled: true, attribute: '45' })];
  await import('./resolver');
  await vi.waitFor(() =>
    expect(fixture.send).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          kind: 'wait',
          wait: expect.objectContaining({ duration_ms: 45000 }),
        }),
      }),
    ),
  );
  expect(click).not.toHaveBeenCalled();
});

it.each(['cancel', 'claim-change', 'continue'])(
  'fences delayed preview authorization on %s',
  async (action) => {
    const click = control('first');
    control('second');
    let release!: (value: { click: boolean }) => void;
    let currentContext = context;
    fixture.send.mockImplementation((message) => {
      if (message.type === 'resolver_context') return Promise.resolve(currentContext);
      if (message.decision.kind === 'click')
        return new Promise((resolve) => {
          release = resolve;
        });
      return Promise.resolve({ click: false });
    });
    await import('./resolver');
    await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledOnce());
    const selected = fixture.preview.mock.calls[0][3] as (
      id: string,
      signal: AbortSignal,
    ) => Promise<void>;
    const cancellation = new AbortController();
    const selection = selected('first', cancellation.signal);
    const outcome =
      action === 'continue'
        ? expect(selection).resolves.toBeUndefined()
        : expect(selection).rejects.toThrow(
            action === 'cancel' ? 'adapter_selection_cancelled' : 'adapter_preview_stale',
          );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (action === 'cancel') cancellation.abort();
    if (action === 'claim-change')
      currentContext = { ...context, scope: { ...scope, claim_generation: 2 } };
    release({ click: true });
    await outcome;
    expect(click).toHaveBeenCalledTimes(action === 'continue' ? 1 : 0);
    expect(fixture.elements.get('first')!.style.outline).toBe('');
  },
);
