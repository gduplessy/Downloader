import browser from 'webextension-polyfill';
import { showChallenge, type ChallengeBridge } from './navigation/challenges/page';
import { decide, classifyBlocker } from './resolver-policy';
import {
  collectControls,
  allElements,
  domFingerprint,
  isVisible,
  requestFor,
  collectWait,
} from './navigation/adapters/dom';
import {
  inspectCandidates,
  type Inspection,
  type EvidenceCandidate,
} from './navigation/adapters/policy';
import {
  createPreview,
  validateSelection,
  SubmissionGate,
  type PreviewBinding,
} from './navigation/adapters/preview';
import { showPreview, type PreviewHandle } from './navigation/adapters/selection-ui';

// Runs only in the top-level tab assigned to an explicit navigation job.
import { scopeKey, type ResolverContext } from './navigation/adapters/context';
const documentRoot = globalThis as typeof globalThis & { __downloaderDocumentNonce?: string };
const documentNonce = (documentRoot.__downloaderDocumentNonce ??= crypto.randomUUID());
let documentGeneration = 1;
let challengeHandle: { close(): void } | undefined;
let previewHandle: PreviewHandle | undefined;
let running = false;
const submissions = new SubmissionGate();
async function context(): Promise<ResolverContext | null> {
  return (await browser.runtime
    .sendMessage({
      type: 'resolver_context',
      document: { nonce: documentNonce, generation: documentGeneration },
    })
    .catch(() => null)) as ResolverContext | null;
}
function blockers(elements: Element[]) {
  const captcha = elements.some(
    (el) =>
      el.matches(
        'iframe[src*="captcha"],[class*="captcha"],[id*="captcha"],iframe[src*="turnstile"]',
      ) && isVisible(el),
  );
  const countdown = collectWait(document).duration_ms !== undefined;
  const text = document.body.innerText;
  const blocker = classifyBlocker({
    text,
    captcha,
    countdown,
    password: elements.some((el) => el.matches('input[type=password]') && isVisible(el)),
    browserChallenge:
      elements.some(
        (el) =>
          el.matches(
            '#challenge-running,#challenge-stage,.cf-challenge-running,#cf-challenge-running',
          ) && isVisible(el),
      ) ||
      /checking your browser/i.test(text) ||
      (/verify you are human/i.test(text) && /cloudflare/i.test(text)),
  });
  return { blocker, countdown };
}
function binding(
  ctx: ResolverContext,
  inspection: Inspection,
  fingerprint: string,
): PreviewBinding {
  return {
    tabId: ctx.tabId,
    frameId: ctx.frameId,
    sessionKey: scopeKey(ctx.scope),
    claimGeneration: ctx.scope.claim_generation,
    documentGeneration,
    page: location.href,
    adapterId: inspection.adapter.id,
    adapterVersion: inspection.adapter.version,
    fingerprint,
  };
}
async function observe(ctx: ResolverContext | null) {
  const collected = collectControls(document),
    signals = blockers(allElements(document));
  const inspection = inspectCandidates(location.href, collected.controls, {
    disabledAdapters: ctx?.disabledAdapters,
    selectedHost: ctx?.selectedHost,
    allowPageBlob: ctx?.capabilities?.pageBlob === true,
    blocked: !!signals.blocker && signals.blocker !== 'countdown',
    countdown: signals.countdown,
  });
  return { collected, signals, inspection, fingerprint: await domFingerprint(collected) };
}
async function submit(
  ctx: ResolverContext,
  observed: Awaited<ReturnType<typeof observe>>,
  chosen: EvidenceCandidate,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Error('adapter_selection_cancelled');
  const bound = binding(ctx, observed.inspection, observed.fingerprint);
  const element = observed.collected.elements.get(chosen.localId);
  if (!element) throw Error('adapter_preview_stale');
  element.scrollIntoView({ block: 'center' });
  const originalOutline = element.style.outline;
  element.style.outline = '3px solid #185ac5';
  let reply: any;
  try {
    reply = await browser.runtime.sendMessage({
      type: 'resolver_step',
      url: location.href,
      decision: {
        kind: 'click',
        reason: 'Following the selected download control.',
        blocker: observed.signals.blocker,
      },
      request: requestFor(element),
      fingerprint: observed.fingerprint,
      binding: bound,
      selected_host: chosen.panelHost ?? ctx.selectedHost ?? null,
      adapter_id: observed.inspection.adapter.id,
      adapter_version: observed.inspection.adapter.version,
    });
    if (signal?.aborted) throw Error('adapter_selection_cancelled');
    if (reply?.direct === true) {
      submissions.consume(bound, chosen.localId);
      return;
    }
    if (!reply?.click) throw Error('adapter_authorization_rejected');
    const freshContext = await context();
    if (!freshContext) throw Error('adapter_preview_stale');
    const fresh = await observe(freshContext);
    validateSelection(
      createPreview(bound, observed.inspection),
      binding(freshContext, fresh.inspection, fresh.fingerprint),
      fresh.inspection,
      chosen.localId,
    );
    if (signal?.aborted) throw Error('adapter_selection_cancelled');
    submissions.consume(bound, chosen.localId);
    element.click();
  } finally {
    element.style.outline = originalOutline;
  }
  if (reply?.repeat) setTimeout(() => void step(), 1000);
}
async function step() {
  if (running) return;
  running = true;
  try {
    challengeHandle?.close();
    challengeHandle = undefined;
    previewHandle?.close();
    previewHandle = undefined;
    const ctx = await context();
    if (ctx) {
      challengeHandle =
        (await showChallenge(
          document,
          {
            context,
            chooseHost: async (host: string) =>
              browser.runtime.sendMessage({
                type: 'resolver_challenge_select',
                selectedHost: host,
                document: { nonce: documentNonce, generation: documentGeneration },
              }),
            authorize: async (bound, signal) => {
              if (signal.aborted) return false;
              const reply = await browser.runtime.sendMessage({
                type: 'resolver_challenge_authorize',
                binding: bound,
                document: { nonce: documentNonce, generation: documentGeneration },
              });
              return !signal.aborted && reply === true;
            },
            paid: async (action, bound, image) =>
              browser.runtime.sendMessage({
                type: 'resolver_challenge_paid',
                binding: bound,
                action,
                image,
                document: { nonce: documentNonce, generation: documentGeneration },
              }),
          } as ChallengeBridge,
          documentGeneration,
          () => {
            setTimeout(() => void step().catch(() => {}), 500);
          },
        )) ?? undefined;
      if (challengeHandle) return;
    }
    const observed = await observe(ctx);
    if (ctx && observed.inspection.kind === 'click' && observed.inspection.selected) {
      await submit(ctx, observed, observed.inspection.selected);
      return;
    }
    if (
      ctx &&
      (observed.inspection.kind === 'preview' ||
        (observed.inspection.kind === 'user' && !observed.signals.blocker))
    ) {
      const preview = createPreview(
        binding(ctx, observed.inspection, observed.fingerprint),
        observed.inspection,
      );
      await browser.runtime.sendMessage({
        type: 'resolver_step',
        url: location.href,
        decision: {
          kind: 'user',
          reason: observed.inspection.reason,
          blocker: observed.signals.blocker,
        },
        fingerprint: observed.fingerprint,
        binding: preview.binding,
      });
      previewHandle = showPreview(
        document,
        preview,
        ctx.locale,
        async (id, signal) => {
          if (signal.aborted) throw Error('adapter_selection_cancelled');
          const freshContext = await context();
          if (!freshContext) throw Error('adapter_preview_stale');
          const fresh = await observe(freshContext);
          const selected = validateSelection(
            preview,
            binding(freshContext, fresh.inspection, fresh.fingerprint),
            fresh.inspection,
            id,
          );
          await submit(freshContext, fresh, selected, signal);
        },
        () => {
          documentGeneration++;
          void step();
        },
        async () => {
          const disabled = await browser.runtime.sendMessage({
            type: 'resolver_disable_adapter',
            adapterId: preview.binding.adapterId,
          });
          if (disabled !== true) throw Error('adapter_disable_rejected');
        },
      );
      return;
    }
    // Until the ownership-aware worker hook is installed, retain the old conservative
    // generic path. Explicit preview never uses a guessed/default browser session.
    const generic = decide(
      observed.collected.controls,
      !!observed.signals.blocker && observed.signals.blocker !== 'countdown',
      observed.signals.countdown,
    );
    const enhanced = observed.inspection;
    const decision = ctx
      ? {
          kind: enhanced.kind === 'preview' ? 'user' : enhanced.kind,
          reason: enhanced.reason,
          blocker: observed.signals.blocker,
        }
      : { ...generic, blocker: observed.signals.blocker };
    const chosen = ctx ? enhanced.selected : observed.collected.controls[generic.index ?? -1];
    const element = chosen ? observed.collected.elements.get(chosen.localId) : undefined;
    const reply: any = await browser.runtime.sendMessage({
      type: 'resolver_step',
      url: location.href,
      decision: {
        ...decision,
        ...(decision.kind === 'wait' ? { wait: collectWait(document) } : {}),
      },
      request: element ? requestFor(element) : undefined,
      fingerprint: observed.fingerprint,
      ...(ctx ? { binding: binding(ctx, observed.inspection, observed.fingerprint) } : {}),
    });
    if (reply?.click && decision.kind === 'click' && element) {
      const fresh = await observe(null);
      if (
        fresh.fingerprint === observed.fingerprint &&
        fresh.collected.elements.get(chosen!.localId) === element
      )
        element.click();
    }
    if (reply?.repeat) setTimeout(() => void step(), 1000);
  } finally {
    running = false;
  }
}
const root = globalThis as typeof globalThis & { __downloaderResolver?: boolean };
if (!root.__downloaderResolver) {
  root.__downloaderResolver = true;
  browser.runtime.onMessage.addListener((message: any) => {
    if (message.type === 'resolver_continue') {
      documentGeneration++;
      void step().catch(() => {});
      return Promise.resolve(true);
    }
    return undefined;
  });
  void step().catch(() => {});
}
