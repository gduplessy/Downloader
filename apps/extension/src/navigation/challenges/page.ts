import { solveOpenCircle, toCss, type Point } from './geometry';
import { ChallengeGate, type ChallengeBinding } from './lifecycle';
import { words } from './messages';
import type { ResolverContext } from '../adapters/context';
type Context = ResolverContext & { sourceGeneration: number };
export type ChallengeBridge = {
  context(): Promise<Context | null>;
  chooseHost?(host: string): Promise<unknown>;
  authorize(binding: ChallengeBinding, signal: AbortSignal): Promise<boolean>;
  paid(
    action: 'start' | 'poll' | 'cancel',
    binding: ChallengeBinding,
    image?: { image_base64: string; instruction: string; width: number; height: number },
  ): Promise<any>;
};
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
/** Explicit qualified image/form contract. Unqualified variants remain manual. */
export function discover(doc: Document) {
  const images = Array.from(
    doc.querySelectorAll<HTMLImageElement>('img[data-downloader-challenge="open-circle-v1"]'),
  );
  if (images.length !== 1) return null;
  const image = images[0],
    form = image.closest('form'),
    x = form?.querySelector<HTMLInputElement>('input[name=captcha_x]'),
    y = form?.querySelector<HTMLInputElement>('input[name=captcha_y]'),
    csrf = form?.querySelector<HTMLInputElement>('input[name=csrf]'),
    submit = form?.querySelector<HTMLButtonElement>('button[type=submit]');
  const instruction = image.getAttribute('data-instruction') ?? '';
  if (
    !form ||
    !x ||
    !y ||
    !csrf ||
    !submit ||
    !image.complete ||
    !image.naturalWidth ||
    !/open circle/i.test(instruction)
  )
    return null;
  const hostInput = form.querySelector<HTMLInputElement>('input[name=selected_host]');
  if (
    !hostInput ||
    form.method.toLowerCase() !== 'post' ||
    new URL(form.action).origin !== doc.location.origin ||
    submit.hasAttribute('formaction') ||
    submit.hasAttribute('formmethod') ||
    form.querySelector('input[type=file]')
  )
    return null;
  for (const name of ['csrf', 'captcha_x', 'captcha_y', 'selected_host'])
    if (form.querySelectorAll('input[name=' + name + ']').length !== 1) return null;
  const width = image.naturalWidth,
    height = image.naturalHeight;
  if (doc.defaultView!.getComputedStyle(image).objectFit !== 'fill') return null;
  if (width > 1000 || height > 1000 || width < 32 || height < 32) return null;
  return { image, form, x, y, csrf, submit, instruction, width, height, hostInput };
}
export async function showChallenge(
  doc: Document,
  bridge: ChallengeBridge,
  documentGeneration: number,
  onSubmitted: () => void,
): Promise<{ close(): void } | null> {
  const found = discover(doc),
    ctx = await bridge.context();
  if (!found || !ctx || !Number.isSafeInteger(ctx.sourceGeneration) || ctx.sourceGeneration < 1 || ctx.documentGeneration !== documentGeneration || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(ctx.documentNonce))
    return null;

  if (!ctx.selectedHost || found.hostInput.value !== ctx.selectedHost) {
    const selected = found.hostInput.value;
    if (
      !bridge.chooseHost ||
      !['g4u.to', 'ddownload.com', 'rapidgator.net', 'gofile.io'].includes(selected)
    )
      return null;
    const locale = words[ctx.locale] ?? words.en,
      host = doc.createElement('div'),
      shadow = host.attachShadow({ mode: 'closed' }),
      panel = doc.createElement('section'),
      heading = doc.createElement('strong'),
      status = doc.createElement('p'),
      choose = doc.createElement('button'),
      manual = doc.createElement('button'),
      labels: Record<string, string> = {
        en: 'Use this file host',
        fr: 'Utiliser ce serveur de fichiers',
        es: 'Usar este servidor de archivos',
        de: 'Diesen Dateihost verwenden',
        ar: 'استخدام مضيف الملفات هذا',
        'zh-CN': '使用此文件主机',
      };
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', locale[0]);
    panel.dir = ctx.locale === 'ar' ? 'rtl' : 'ltr';
    panel.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:white;color:#162138;padding:18px;border:2px solid #185ac5;font:15px system-ui';
    heading.textContent = locale[0];
    status.setAttribute('role', 'status');
    choose.type = manual.type = 'button';
    choose.textContent = (labels[ctx.locale] ?? labels.en) + ': ' + selected;
    manual.textContent = locale[2];
    let closed = false;
    const close = () => { closed = true; host.remove(); };
    manual.onclick = close;
    choose.onclick = () => {
      choose.disabled = true;
      void bridge.chooseHost!(selected)
        .then(() => {
          if (closed) return;
          close();
          onSubmitted();
        })
        .catch(() => {
          if (!closed) { status.textContent = locale[4]; choose.disabled = false; }
        });
    };
    panel.onkeydown = (e) => {
      if (e.key === 'Escape') close();
    };
    panel.append(heading, status, choose, manual);
    shadow.append(panel);
    doc.documentElement.append(host);
    choose.focus();
    return { close };
  }
  const controller = new AbortController(),
    gate = new ChallengeGate(),
    locale = words[ctx.locale] ?? words.en;
  const canvas = doc.createElement('canvas');
  canvas.width = found.width;
  canvas.height = found.height;
  const rendering = canvas.getContext('2d', { willReadFrequently: true });
  if (!rendering) return null;
  let raster: ImageData, dataUrl: string;
  try {
    rendering.drawImage(found.image, 0, 0);
    raster = rendering.getImageData(0, 0, found.width, found.height);
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  const expiry = Number(found.image.dataset.expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) return null;
  const capture = async (current: Context): Promise<ChallengeBinding> => ({
    scope: {
      browser: current.scope.browser,
      profile: current.scope.profile,
      private: current.scope.private,
      cookie_store_id: current.scope.cookie_store_id,
      container_id: current.scope.container_id,
      partition_key: current.scope.partition_key
        ? {
            top_level_site: current.scope.partition_key.top_level_site,
            ...(current.scope.partition_key.has_cross_site_ancestor === undefined
              ? {}
              : { has_cross_site_ancestor: current.scope.partition_key.has_cross_site_ancestor }),
          }
        : null,
      claim_generation: current.scope.claim_generation,
    },
    sourceGeneration: current.sourceGeneration,
    documentGeneration: current.documentGeneration,
    documentNonce: current.documentNonce,
    page: doc.location.href,
    selectedHost: current.selectedHost ?? '',
    imageDigest: await digest(found.image.currentSrc + '|' + dataUrl),
    csrfDigest: await digest(found.csrf.value),
    formDigest: await digest(
      JSON.stringify({
        action: found.form.action,
        method: found.form.method,
        encoding: found.form.enctype,
        submitter: { name: found.submit.name, value: found.submit.value },
        fields: Array.from(new FormData(found.form).entries()),
      }),
    ),
    expiresAt: expiry,
  });
  const initial = await capture(ctx);
  let paidBinding: string | undefined,
    submitted = false;
  const host = doc.createElement('div');
  host.id = 'downloader-challenge';
  const shadow = host.attachShadow({ mode: 'closed' }),
    panel = doc.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', locale[0]);
  panel.dir = ctx.locale === 'ar' ? 'rtl' : 'ltr';
  const style = doc.createElement('style');
  style.textContent =
    'section{position:fixed;z-index:2147483647;bottom:20px;right:20px;max-width:380px;background:white;color:#162138;padding:18px;border:2px solid #185ac5;font:15px system-ui;box-shadow:0 2px 12px #444}button{margin:4px;padding:8px}button:focus-visible{outline:3px solid #185ac5}';
  shadow.append(style, panel);
  const title = doc.createElement('strong');
  title.textContent = locale[0];
  panel.append(title);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(status);
  const previous = doc.activeElement as HTMLElement | null;
  const close = () => {
    controller.abort();
    gate.cancel(initial);
    host.remove();
    if (previous?.isConnected) previous.focus();
    if (paidBinding) void bridge.paid('cancel', initial).catch(() => {});
  };
  const fresh = async () => {
    if (
      controller.signal.aborted ||
      submitted ||
      !found.image.isConnected ||
      !found.form.isConnected ||
      discover(doc)?.image !== found.image
    )
      throw Error('challenge_stale');
    const current = await bridge.context();
    if (!current) throw Error('challenge_stale');
    const freshCanvas = doc.createElement('canvas');
    freshCanvas.width = found.width;
    freshCanvas.height = found.height;
    const freshRendering = freshCanvas.getContext('2d', {willReadFrequently:true})!;
    freshRendering.drawImage(found.image, 0, 0);
    freshRendering.getImageData(0,0,found.width,found.height);
    const currentUrl = freshCanvas.toDataURL('image/png');
    const binding = await capture(current);
    binding.imageDigest = await digest(found.image.currentSrc + '|' + currentUrl);
    if (JSON.stringify(initial) !== JSON.stringify(binding) || Date.now() >= binding.expiresAt)
      throw Error('challenge_stale');
    return binding;
  };
  const submit = async (point: Point) => {
    await fresh();
    if (!(await bridge.authorize(initial, controller.signal))) throw Error('challenge_rejected');
    const current = await fresh();
    gate.authorize(initial, current, Date.now());
    const bounds = found.image.getBoundingClientRect(),
      computed = doc.defaultView!.getComputedStyle(found.image),
      left = parseFloat(computed.borderLeftWidth) + parseFloat(computed.paddingLeft),
      top = parseFloat(computed.borderTopWidth) + parseFloat(computed.paddingTop),
      right = parseFloat(computed.borderRightWidth) + parseFloat(computed.paddingRight),
      bottom = parseFloat(computed.borderBottomWidth) + parseFloat(computed.paddingBottom);
    const css = toCss(
      point,
      { width: found.width, height: found.height },
      {
        left: bounds.left + left,
        top: bounds.top + top,
        width: bounds.width - left - right,
        height: bounds.height - top - bottom,
      },
      {
        left: Math.max(bounds.left, 0),
        top: Math.max(bounds.top, 0),
        right: Math.min(bounds.right, doc.defaultView!.innerWidth),
        bottom: Math.min(bounds.bottom, doc.defaultView!.innerHeight),
      },
    );
    if (doc.elementFromPoint(css.x, css.y) !== found.image) throw Error('occluded_target');
    // Coordinates submitted in intrinsic image space, as the qualified form specifies.
    if (controller.signal.aborted) throw Error('challenge_stale');
    submitted = true;
    found.x.value = String(Math.round(point.x));
    found.y.value = String(Math.round(point.y));
    found.form.requestSubmit(found.submit);
    status.textContent = locale[5];
    onSubmitted();
    close();
  };
  const button = (label: string, action: () => Promise<void> | void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => {
      b.disabled = true;
      Promise.resolve(action())
        .catch(() => {
          status.textContent = locale[4];
        })
        .finally(() => {
          if (!controller.signal.aborted) b.disabled = false;
        });
    };
    panel.append(b);
    return b;
  };
  button(locale[1], async () => {
    const result = solveOpenCircle(raster);
    if (!('point' in result)) throw Error(result.reason);
    await submit(result.point);
  });
  button(locale[2], close);
  const paid = button(locale[3], async () => {
    await fresh();
    paidBinding = await digest(JSON.stringify(initial));
    let response = await bridge.paid('start', initial, {
      image_base64: dataUrl.split(',')[1],
      instruction: 'Click the open circle',
      width: found.width,
      height: found.height,
    });
    for (let i = 0; i < 120 && !controller.signal.aborted; i++) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (controller.signal.aborted) return;
      await fresh();
      response = await bridge.paid('poll', initial);
      if (response.status === 'ready') {
        await submit(response.point);
        return;
      }
      if (response.status !== 'processing') throw Error('challenge_provider_terminal');
    }
    throw Error('challenge_provider_deadline');
  });
  paid.disabled = ctx.scope.private;
  const explanation = doc.createElement('p');
  explanation.textContent = locale[6];
  panel.append(explanation);
  button(locale[7], close);
  panel.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  const observer = new MutationObserver(() => {
    if (!found.image.isConnected || found.image.dataset.expiresAt !== String(expiry)) close();
  });
  observer.observe(found.form, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-expires-at'],
  });
  controller.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  doc.documentElement.append(host);
  panel.querySelector<HTMLButtonElement>('button')?.focus();
  return { close };
}
