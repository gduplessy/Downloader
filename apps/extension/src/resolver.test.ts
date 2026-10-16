import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ResolverContext } from './navigation/adapters/context';
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
  domFingerprint: async () => 'f'.repeat(64),
}));
vi.mock('./navigation/adapters/selection-ui', () => ({ showPreview: fixture.preview }));
// These cases have no challenge/account selection; keep unrelated UI out of the DOM shim.
vi.mock('./navigation/challenges/page', () => ({ showChallenge: async () => null }));

const scope = {
  browser: 'chromium',
  profile: 'b97c5662-21f5-4ae8-92e8-7d119c348ac0',
  private: false,
  cookie_store_id: null,
  container_id: null,
  partition_key: null,
  claim_generation: 1,
};
const documentNonce = '31eb8f66-ad71-4897-a797-5b0344e9aa84';
const context: ResolverContext = {
  tabId: 7,
  frameId: 0,
  scope,
  sourceGeneration: 1,
  documentNonce,
  documentGeneration: 1,
  documentId: 'fixture-document',
  locale: 'en',
};
const authorization = '41504025-8925-46b3-927f-bda4381c537f';
let windowListeners: Map<string, () => void>;
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
  windowListeners = new Map();
  vi.stubGlobal('window', {
    addEventListener: (event: string, listener: () => void) => windowListeners.set(event, listener),
  });
  vi.stubGlobal('__downloaderDocumentNonce', documentNonce);
  documentFixture = {
    body: { innerText: '' },
    defaultView: { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
    querySelectorAll: () => timers,
  } as unknown as Document;
  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('location', { href: 'http://127.0.0.1/nav-adapters/g4u/wait' });
  delete (globalThis as { __downloaderResolver?: boolean }).__downloaderResolver;
  fixture.send.mockImplementation(async (message) =>
    message.type === 'resolver_context'
      ? context
      : message.type === 'resolver_account'
        ? null
        : { click: false },
  );
  fixture.preview.mockReturnValue({ close: vi.fn() });
});
afterEach(() => {
  windowListeners.get('pagehide')?.();
  delete (globalThis as { __downloaderResolver?: boolean }).__downloaderResolver;
  vi.unstubAllGlobals();
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
      message.type === 'resolver_context'
        ? owned
          ? context
          : null
        : message.type === 'resolver_account'
          ? null
          : { click: false },
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
    expect(message.document).toEqual({ nonce: documentNonce, generation: 1 });
    if (owned) expect(message.binding).toMatchObject({ sourceGeneration: 1, documentNonce });
    else expect(message.binding).toBeUndefined();
    expect(fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_commit')).toHaveLength(0);
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

// Delay each phase independently: prepare must burn a late token; commit must
// revalidate current authority before performing a browser action.
const actions = [
  'cancel',
  'claim-change',
  'source-change',
  'document-change',
  'pagehide',
  'continue',
] as const;
const phases = ['prepare', 'commit'] as const;
const delayedCases = phases.flatMap((phase) => actions.map((action) => ({ phase, action })));
it.each(delayedCases)(
  'fences delayed preview $phase authorization on $action',
  async ({ phase, action }) => {
    const click = control('first');
    control('second');
    let release!: (value: { authorization?: string; click?: boolean }) => void;
    let currentContext = context;
    fixture.send.mockImplementation((message) => {
      if (message.type === 'resolver_context') return Promise.resolve(currentContext);
      if (message.type === 'resolver_account') return Promise.resolve(null);
      if (message.type === 'resolver_step' && message.decision.kind === 'click')
        return phase === 'prepare'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ authorization });
      if (message.type === 'resolver_commit')
        return phase === 'commit'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ click: true });
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
    // A queued automatic wake must not suppress a later real invalidation.
    const wake = fixture.listener.mock.calls[0][0] as (message: unknown) => unknown;
    await wake({ type: 'resolver_continue', automatic: true });
    if (action === 'cancel') cancellation.abort();
    if (action === 'claim-change')
      currentContext = { ...context, scope: { ...scope, claim_generation: 2 } };
    if (action === 'source-change') currentContext = { ...context, sourceGeneration: 2 };
    if (action === 'document-change') {
      const listener = fixture.listener.mock.calls[0][0] as (message: unknown) => unknown;
      await listener({ type: 'resolver_continue' });
    }
    if (action === 'pagehide') windowListeners.get('pagehide')!();
    release(phase === 'prepare' ? { authorization } : { click: true });
    await outcome;
    expect(click).toHaveBeenCalledTimes(action === 'continue' ? 1 : 0);
    expect(fixture.elements.get('first')!.style.outline).toBe('');
    const prepare = fixture.send.mock.calls.find(
      ([m]) => m.type === 'resolver_step' && m.decision.kind === 'click',
    )![0];
    expect(prepare.document).toEqual({ nonce: documentNonce, generation: 1 });
    expect(prepare.binding).toMatchObject({
      documentNonce,
      documentGeneration: 1,
      sourceGeneration: 1,
      claimGeneration: 1,
    });
    const commits = fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_commit');
    expect(commits).toHaveLength(phase === 'commit' || action === 'continue' ? 1 : 0);
    for (const [commit] of commits) {
      expect(commit).toMatchObject({
        token: authorization,
        document: { nonce: documentNonce, generation: 1 },
        binding: { documentNonce, documentGeneration: 1, sourceGeneration: 1, claimGeneration: 1 },
      });
    }
    const aborts = fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_abort');
    if (action === 'continue') expect(aborts).toHaveLength(0);
    else expect(aborts.some(([m]) => m.token === authorization)).toBe(true);
  },
);

it('keeps stale preview recovery controls when refresh temporarily loses owned context', async () => {
  control('first');
  control('second');
  const close = vi.fn();
  const stale = vi.fn();
  fixture.preview.mockReturnValue({ close, stale });
  await import('./resolver');
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(1));
  const disable = fixture.preview.mock.calls[0][5] as () => Promise<void>;
  fixture.send.mockImplementation(async (message) =>
    message.type === 'resolver_disable_adapter' ? true : null,
  );
  await disable();
  expect(fixture.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'resolver_disable_adapter', adapterId: 'local-fixture' }),
  );
  fixture.send.mockImplementation(async (message) => {
    if (message.type === 'resolver_context') throw Error('temporary ownership observation failure');
    if (message.type === 'resolver_account') return null;
    return { click: false };
  });
  const refresh = fixture.preview.mock.calls[0][4] as () => void;
  refresh();
  await vi.waitFor(() => expect(stale).toHaveBeenCalledTimes(1));
  expect(close).not.toHaveBeenCalled();
  const select = fixture.preview.mock.calls[0][3] as (
    id: string,
    signal: AbortSignal,
  ) => Promise<void>;
  await expect(select('first', new AbortController().signal)).rejects.toThrow(
    'adapter_preview_stale',
  );
  expect(
    fixture.send.mock.calls.some(
      ([m]) => m.type === 'resolver_prepare' || m.type === 'resolver_commit',
    ),
  ).toBe(false);
  for (const element of fixture.elements.values()) expect(element.click).not.toHaveBeenCalled();
  fixture.send.mockImplementation(async (message) =>
    message.type === 'resolver_context'
      ? {
          ...context,
          documentGeneration: message.document.generation,
          disabledAdapters: ['local-fixture'],
        }
      : message.type === 'resolver_account'
        ? null
        : { click: false },
  );
  refresh();
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(2));
  expect(close).toHaveBeenCalledTimes(1);
  expect(fixture.preview.mock.calls[1][1].binding.adapterId).toBe('generic');
});

it('coalesces refresh during an in-flight ownership observation and rereads fresh authority', async () => {
  control('first');
  control('second');
  fixture.preview.mockReturnValue({ close: vi.fn(), stale: vi.fn() });
  await import('./resolver');
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(1));
  let release!: (value: ResolverContext | null) => void;
  let observations = 0;
  fixture.send.mockImplementation(async (message) => {
    if (message.type === 'resolver_context') {
      observations++;
      if (observations === 1)
        return new Promise<ResolverContext | null>((resolve) => {
          release = resolve;
        });
      return {
        ...context,
        documentGeneration: message.document.generation,
        disabledAdapters: ['local-fixture'],
      };
    }
    return message.type === 'resolver_account' ? null : { click: false };
  });
  const refresh = fixture.preview.mock.calls[0][4] as () => void;
  refresh();
  await vi.waitFor(() => expect(observations).toBe(1));
  refresh();
  release(null);
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(2));
  expect(observations).toBe(2);
  expect(fixture.preview.mock.calls[1][1].binding.adapterId).toBe('generic');
  expect(fixture.preview.mock.calls[1][1].binding.documentGeneration).toBe(3);
  for (const element of fixture.elements.values()) expect(element.click).not.toHaveBeenCalled();
});

it('keeps the stale preview until a replacement has passed its worker step', async () => {
  control('first');
  control('second');
  const close = vi.fn(),
    stale = vi.fn();
  fixture.preview.mockReturnValue({ close, stale });
  await import('./resolver');
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(1));
  fixture.send.mockImplementation(async (message) => {
    if (message.type === 'resolver_context')
      return {
        ...context,
        documentGeneration: message.document.generation,
        disabledAdapters: ['local-fixture'],
      };
    if (message.type === 'resolver_step')
      throw Error('transient step ownership observation failure');
    return null;
  });
  const refresh = fixture.preview.mock.calls[0][4] as () => void;
  refresh();
  await vi.waitFor(() =>
    expect(fixture.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resolver_step',
        document: { nonce: documentNonce, generation: 2 },
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(stale).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(fixture.preview).toHaveBeenCalledTimes(1);
  for (const element of fixture.elements.values()) expect(element.click).not.toHaveBeenCalled();
});

it.each(['context', 'worker-step'] as const)(
  'does not resurrect a cancelled preview after pending %s refresh; later explicit Continue works',
  async (phase) => {
    control('first');
    control('second');
    const lifetime = new AbortController();
    const close = vi.fn(() => lifetime.abort());
    fixture.preview.mockReturnValue({ close, stale: vi.fn(), signal: lifetime.signal });
    await import('./resolver');
    await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(1));
    let release!: () => void;
    let held = false;
    fixture.send.mockImplementation(async (message) => {
      if (!held && message.type === (phase === 'context' ? 'resolver_context' : 'resolver_step')) {
        held = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return message.type === 'resolver_context'
        ? {
            ...context,
            documentGeneration: message.document.generation,
            disabledAdapters: ['local-fixture'],
          }
        : message.type === 'resolver_account'
          ? null
          : { click: false };
    });
    const refresh = fixture.preview.mock.calls[0][4] as () => void;
    refresh();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    refresh(); // A coalesced request issued before Cancel must be invalidated too.
    close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fixture.preview).toHaveBeenCalledTimes(1);
    for (const element of fixture.elements.values()) expect(element.click).not.toHaveBeenCalled();
    expect(
      fixture.send.mock.calls.some(
        ([m]) => m.type === 'resolver_prepare' || m.type === 'resolver_commit',
      ),
    ).toBe(false);
    const listener = fixture.listener.mock.calls[0][0] as (message: unknown) => Promise<boolean>;
    await listener({ type: 'resolver_continue' });
    await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(2));
    expect(fixture.preview.mock.calls[1][1].binding.adapterId).toBe('generic');
  },
);

it.each(['prepare', 'commit'] as const)(
  'does not stale an in-flight selected %s on an automatic wait wake',
  async (phase) => {
    const click = control('first');
    control('second');
    let release!: (value: { authorization?: string; click?: boolean }) => void;
    fixture.send.mockImplementation((message) => {
      if (message.type === 'resolver_context') return Promise.resolve(context);
      if (message.type === 'resolver_account') return Promise.resolve(null);
      if (message.type === 'resolver_step' && message.decision.kind === 'click')
        return phase === 'prepare'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ authorization });
      if (message.type === 'resolver_commit')
        return phase === 'commit'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ click: true });
      return Promise.resolve({ click: false });
    });
    await import('./resolver');
    await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledOnce());
    const selected = fixture.preview.mock.calls[0][3] as (
      id: string,
      signal: AbortSignal,
    ) => Promise<void>;
    const selection = selected('first', new AbortController().signal);
    const outcome = expect(selection).resolves.toBeUndefined();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const listener = fixture.listener.mock.calls[0][0] as (message: unknown) => unknown;
    await listener({ type: 'resolver_continue', automatic: true });
    release(phase === 'prepare' ? { authorization } : { click: true });
    await outcome;
    expect(click).toHaveBeenCalledOnce();
    expect(fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_abort')).toHaveLength(0);
    const commit = fixture.send.mock.calls.find(([m]) => m.type === 'resolver_commit')![0];
    expect(commit.document).toEqual({ nonce: documentNonce, generation: 1 });
  },
);

it('coalesces automatic wakes after refusal and reobserves once without replaying the selection', async () => {
  const click = control('first');
  control('second');
  fixture.preview.mockReturnValue({ close: vi.fn(), stale: vi.fn() });
  let release!: (value: { authorization: string }) => void;
  let source = 1;
  fixture.send.mockImplementation((message) => {
    if (message.type === 'resolver_context')
      return Promise.resolve({ ...context, sourceGeneration: source });
    if (message.type === 'resolver_account') return Promise.resolve(null);
    if (message.type === 'resolver_step' && message.decision.kind === 'click')
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
  const selection = selected('first', new AbortController().signal);
  const outcome = expect(selection).rejects.toThrow('adapter_preview_stale');
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const listener = fixture.listener.mock.calls[0][0] as (message: unknown) => unknown;
  await listener({ type: 'resolver_continue', automatic: true });
  await listener({ type: 'resolver_continue', automatic: true });
  await listener({ type: 'resolver_continue', automatic: true });
  source = 2;
  release({ authorization });
  await outcome;
  await vi.waitFor(() => expect(fixture.preview).toHaveBeenCalledTimes(2));
  expect(fixture.preview.mock.calls[1][1].binding.documentGeneration).toBe(2);
  expect(fixture.preview.mock.calls[1][1].binding.sourceGeneration).toBe(2);
  expect(click).not.toHaveBeenCalled();
  expect(
    fixture.send.mock.calls.filter(
      ([m]) => m.type === 'resolver_step' && m.decision.kind === 'click',
    ),
  ).toHaveLength(1);
  expect(fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_commit')).toHaveLength(0);
});

it.each(['prepare', 'commit'] as const)(
  'keeps automatic single-control %s authority across wait wake',
  async (phase) => {
    const click = control('only');
    let release!: (value: { authorization?: string; click?: boolean }) => void;
    fixture.send.mockImplementation((message) => {
      if (message.type === 'resolver_context') return Promise.resolve(context);
      if (message.type === 'resolver_account') return Promise.resolve(null);
      if (message.type === 'resolver_step' && message.decision.kind === 'click')
        return phase === 'prepare'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ authorization });
      if (message.type === 'resolver_commit')
        return phase === 'commit'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve({ click: true });
      return Promise.resolve({ click: false });
    });
    await import('./resolver');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const listener = fixture.listener.mock.calls[0][0] as (message: unknown) => unknown;
    await listener({ type: 'resolver_continue', automatic: true });
    release(phase === 'prepare' ? { authorization } : { click: true });
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fixture.preview).not.toHaveBeenCalled();
    expect(fixture.send.mock.calls.filter(([m]) => m.type === 'resolver_abort')).toHaveLength(0);
    const commit = fixture.send.mock.calls.find(([m]) => m.type === 'resolver_commit')![0];
    expect(commit.document).toEqual({ nonce: documentNonce, generation: 1 });
  },
);
