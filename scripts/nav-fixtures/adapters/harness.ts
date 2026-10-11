import {
  collectControls,
  domFingerprint,
  requestFor,
  collectWait,
} from '../../../apps/extension/src/navigation/adapters/dom';
import {
  inspectCandidates,
  type Inspection,
} from '../../../apps/extension/src/navigation/adapters/policy';
import {
  createPreview,
  validateSelection,
  SubmissionGate,
  type PreviewBinding,
} from '../../../apps/extension/src/navigation/adapters/preview';
import { showPreview } from '../../../apps/extension/src/navigation/adapters/selection-ui';
const check = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
const fakeBinding = (
  page: string,
  inspection: Inspection,
  fingerprint: string,
): PreviewBinding => ({
  tabId: 1,
  frameId: 0,
  sessionKey: 'fixture-profile',
  claimGeneration: 1,
  documentGeneration: 1,
  page,
  adapterId: inspection.adapter.id,
  adapterVersion: inspection.adapter.version,
  fingerprint,
});
async function inspected(doc: Document, options = {}) {
  const collected = collectControls(doc);
  return {
    collected,
    inspection: inspectCandidates(doc.location.href, collected.controls, options),
    fingerprint: await domFingerprint(collected),
  };
}
async function load(provider: string, scenario: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement('iframe');
  iframe.style.width = '800px';
  iframe.style.height = '500px';
  const ready = new Promise<void>((resolve) =>
    iframe.addEventListener('load', () => resolve(), { once: true }),
  );
  iframe.src = `/nav-adapters/${provider}/${scenario}`;
  document.body.append(iframe);
  await ready;
  return iframe;
}
async function clickAndHash(
  doc: Document,
  element: HTMLElement,
): Promise<{ hash: string; filename: string; method: string }> {
  return await new Promise((resolve, reject) => {
    element.addEventListener(
      'click',
      (event) => {
        // Synthetic request bridge: exercise the actual chosen DOM click and request
        // semantics while retaining bytes for hash inspection. This is not native transfer acceptance.
        event.preventDefault();
        const request = requestFor(element)!;
        const form = (element as HTMLButtonElement).form;
        const body =
          request.method === 'POST' && form
            ? new URLSearchParams(
                [...new FormData(form)].filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              )
            : undefined;
        void fetch(request.url, { method: request.method, body })
          .then(async (response) => {
            check(response.ok, 'file response failed');
            const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
            resolve({
              hash: [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join(''),
              filename: response.headers.get('content-disposition') ?? '',
              method: request.method,
            });
          })
          .catch(reject);
      },
      { once: true },
    );
    element.click();
  });
}
async function suite() {
  let checks = 0;
  const expected = (await (await fetch('/status')).json()).expectedHash;
  for (const provider of ['g4u', 'ddownload', 'rapidgator', 'gofile']) {
    for (const scenario of [
      'get',
      'post',
      'shadow',
      'ads',
      'unsafe',
      'replaced',
      'wait',
      'chosen',
      'changed',
      'submitter',
      'hidden',
      'script',
      'token',
      'closed',
    ]) {
      const iframe = await load(provider, scenario),
        doc = iframe.contentDocument!;
      try {
        const before = await inspected(doc);
        if (['get', 'post', 'shadow', 'ads', 'submitter', 'hidden'].includes(scenario)) {
          check(
            before.inspection.kind === 'click',
            `${provider}/${scenario} should select one control`,
          );
          const chosen = before.inspection.selected!;
          const file = await clickAndHash(doc, before.collected.elements.get(chosen.localId)!);
          check(
            file.hash === expected && file.filename.includes(provider + '-fixture.bin'),
            'wrong intended file/hash',
          );
          check(file.method === (scenario === 'post' ? 'POST' : 'GET'), 'wrong request method');
          checks += 3;
        } else if (scenario === 'unsafe' || scenario === 'changed' || scenario === 'closed') {
          check(before.inspection.kind === 'user', 'unsafe/changed layout must stop');
          checks++;
        } else if (scenario === 'script') {
          check(before.inspection.kind === 'preview', 'script button must need explicit selection');
          check(
            requestFor(before.collected.elements.get(before.collected.controls[0].localId)!) ===
              undefined,
            'script button must not guess a form request',
          );
          checks += 2;
        } else if (scenario === 'token') {
          (doc.querySelector('#token') as HTMLInputElement).value = 'public-two';
          const after = await inspected(doc);
          check(
            before.fingerprint !== after.fingerprint,
            'changed hidden form value must invalidate fingerprint',
          );
          checks++;
        } else if (scenario === 'replaced') {
          const preview = createPreview(
            fakeBinding(doc.location.href, before.inspection, before.fingerprint),
            before.inspection,
          );
          const original = doc.querySelector('#replace')!;
          original.replaceWith(original.cloneNode(true));
          const after = await inspected(doc);
          let rejected = false;
          try {
            validateSelection(
              preview,
              fakeBinding(doc.location.href, after.inspection, after.fingerprint),
              after.inspection,
              before.collected.controls[0].localId,
            );
          } catch {
            rejected = true;
          }
          check(rejected, 'same HTML replacement must be stale');
          checks++;
        } else if (scenario === 'wait') {
          check(before.inspection.kind === 'wait', 'disabled control must wait');
          check(collectWait(doc).duration_ms === 2000, 'visible timer duration must be captured');
          checks += 2;
        } else if (scenario === 'chosen') {
          const current = await inspected(doc, { selectedHost: 'ddownload.com' });
          const preview = createPreview(
            fakeBinding(doc.location.href, current.inspection, current.fingerprint),
            current.inspection,
          );
          check(
            preview.candidates.length === 2 &&
              preview.candidates.every((c) => c.panelHost === 'ddownload.com'),
            'selected provider group wrong',
          );
          const last = preview.candidates[1];
          const selected = validateSelection(
            preview,
            preview.binding,
            current.inspection,
            last.localId,
          );
          const gate = new SubmissionGate();
          gate.consume(preview.binding, selected.localId);
          const file = await clickAndHash(doc, current.collected.elements.get(selected.localId)!);
          check(
            file.hash === expected && file.filename.includes(provider + '-fixture.bin'),
            'chosen panel request wrong',
          );
          let duplicate = false;
          try {
            gate.consume(preview.binding, selected.localId);
          } catch {
            duplicate = true;
          }
          check(duplicate, 'duplicate submission allowed');
          checks += 3;
        }
      } finally {
        iframe.remove();
      }
    }
  }
  return {
    fixture: 'synthetic-adapter-dom-request-v1',
    checks,
    outcome: 'passed',
    expected_sha256: expected,
    transport_host: location.hostname,
    selected_host_fixture: 'ddownload.com',
    userAgent: navigator.userAgent,
  };
}
async function preview(locale = 'en') {
  const current = await inspected(document);
  const created = createPreview(
    fakeBinding(location.href, current.inspection, current.fingerprint),
    current.inspection,
  );
  showPreview(
    document,
    created,
    locale,
    async (id) => {
      const fresh = await inspected(document);
      const selected = validateSelection(
        created,
        fakeBinding(location.href, fresh.inspection, fresh.fingerprint),
        fresh.inspection,
        id,
      );
      const result = await clickAndHash(document, fresh.collected.elements.get(selected.localId)!);
      (window as any).lastAdapterFixtureResult = result;
    },
    () => void preview(locale),
  );
  return {
    candidates: created.candidates.map((c) => ({
      label: c.text,
      host: c.panelHost ?? c.destinationHost,
      action: c.action,
    })),
  };
}

async function prepareRuntime() {
  const metrics = {
    selected_authorizations: 0,
    control_clicks: 0,
    file_hash: null as string | null,
    disabled_adapter: null as string | null,
  };
  let authorize: ((reply: unknown) => void) | undefined;
  const ctx = {
    tabId: 4,
    frameId: 0,
    scope: {
      browser: 'chromium',
      profile: 'public-fixture-profile',
      private: false,
      cookie_store_id: null,
      container_id: null,
      partition_key: { top_level_site: location.origin },
      claim_generation: 1,
    },
    selectedHost: undefined,
    disabledAdapters: [] as string[],
    locale: 'en',
  };
  for (const element of document.querySelectorAll<HTMLElement>('a[href],button')) {
    element.addEventListener('click', (event) => {
      if (!element.matches('a[href],button')) return;
      event.preventDefault();
      metrics.control_clicks++;
      const request = requestFor(element);
      if (request)
        void fetch(request.url)
          .then((response) => response.arrayBuffer())
          .then((bytes) => crypto.subtle.digest('SHA-256', bytes))
          .then((hash) => {
            metrics.file_hash = [...new Uint8Array(hash)]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join('');
          });
    });
  }
  (window as any).__navMockBrowser = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async (message: any) => {
        if (message.type === 'resolver_context') return structuredClone(ctx);
        if (message.type === 'resolver_disable_adapter') {
          ctx.disabledAdapters.push(message.adapterId);
          metrics.disabled_adapter = message.adapterId;
          return true;
        }
        if (message.type === 'resolver_step' && message.decision.kind === 'click') {
          metrics.selected_authorizations++;
          return await new Promise((resolve) => {
            authorize = resolve;
          });
        }
        if (message.type === 'resolver_step') return { click: false, repeat: false };
        throw Error('Unexpected fixture worker message');
      },
    },
  };
  (window as any).navResolverUnderTest = {
    metrics: () => structuredClone(metrics),
    release: () => {
      authorize?.({ click: true, repeat: false });
    },
    takeover: () => {
      ctx.scope.claim_generation++;
    },
  };
  const script = document.createElement('script');
  script.src = '/resolver-under-test.js';
  const loaded = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(Error('Resolver fixture bundle failed')), {
      once: true,
    });
  });
  document.head.append(script);
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 60));
  return 'Real resolver loaded against scoped fixture worker; installed native dispatch remains separate';
}
(window as any).navAdapterFixture = {
  prepareRuntime,
  suite,
  preview,
  inspect: () =>
    inspected(document).then(({ inspection }) => ({
      kind: inspection.kind,
      candidates: inspection.candidates.map((c) => ({
        label: c.text,
        confidence: c.confidence,
        rejections: c.rejections,
      })),
    })),
};
