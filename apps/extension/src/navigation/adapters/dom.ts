import type { Control } from './policy';
import { countdownDuration } from '../scheduler/timers';
const identities = new WeakMap<Element, string>();
let nextId = 0;
function identity(element: Element): string {
  let id = identities.get(element);
  if (!id) {
    id = 'control-' + ++nextId;
    identities.set(element, id);
  }
  return id;
}
export function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || element.closest('[hidden],[inert]')) return false;
  const style = view.getComputedStyle(element),
    bounds = element.getBoundingClientRect();
  return (
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    style.display !== 'none' &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}
export function allElements(root: Document | ShadowRoot): Element[] {
  const result: Element[] = [];
  for (const element of root.querySelectorAll('*')) {
    // Ignore the extension's own isolated preview UI.
    if (element.id === '__downloader_adapter_preview' || element.closest('[data-downloader-ui]'))
      continue;
    result.push(element);
    if (element.shadowRoot) result.push(...allElements(element.shadowRoot));
  }
  return result;
}
export type CollectedControls = {
  controls: Control[];
  elements: Map<string, HTMLElement>;
  secretsFingerprint: string;
};
export function collectControls(document: Document): CollectedControls {
  const elements = new Map<string, HTMLElement>();
  const forms: unknown[] = [];
  const controls: Control[] = [];
  for (const node of allElements(document)) {
    if (!node.matches('a[href],button,input[type=submit],input[type=button]')) continue;
    const element = node as HTMLElement;
    const localId = identity(element);
    elements.set(localId, element);
    const input = element.tagName === 'INPUT';
    const link = element.tagName === 'A';
    const submit = element as HTMLButtonElement | HTMLInputElement;
    const form = !link && submit.type !== 'button' && submit.type !== 'reset' ? submit.form : null;
    const method = form ? (submit.getAttribute('formmethod') ?? form.method).toUpperCase() : '';
    const target = link
      ? (element as HTMLAnchorElement).href
      : form
        ? new URL(submit.getAttribute('formaction') ?? form.action, document.baseURI).href
        : undefined;
    if (form) {
      const fields = [...new FormData(form)].map(([name, value]) => [
        name,
        typeof value === 'string' ? value : [value.name, value.size, value.lastModified],
      ]);
      forms.push([
        localId,
        identity(form),
        fields,
        form.enctype,
        submit.getAttribute('name'),
        submit.getAttribute('value'),
      ]);
    }
    forms.push([
      localId,
      element.getAttribute('download'),
      element.getAttribute('target'),
      element.getAttribute('type'),
      element.getAttribute('name'),
      element.getAttribute('value'),
    ]);
    const panel = element.closest('[data-download-host]');
    const ad = element.closest('[data-ad],.advertisement,.sponsored,[aria-label*="sponsor" i]');
    controls.push({
      localId,
      text: (input
        ? (element as HTMLInputElement).value
        : element.innerText || element.getAttribute('aria-label') || element.textContent || ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240),
      href: link ? target : undefined,
      target,
      visible: isVisible(element),
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
      download: element.hasAttribute('download'),
      id: element.id,
      action: link ? 'link' : method === 'GET' || method === 'POST' ? method : 'script',
      panelHost: panel?.getAttribute('data-download-host') ?? undefined,
      group: panel ? identity(panel) : undefined,
      order: controls.length,
      fixture: element.hasAttribute('data-nav-fixture-control'),
      premium: element.hasAttribute('data-nav-premium-control'),
      contextualText: ad ? 'advertisement sponsor' : undefined,
    });
  }
  // This input stays local and is only exposed as a SHA-256 hash. Never persist raw form data.
  return { controls, elements, secretsFingerprint: JSON.stringify(forms) };
}
export async function domFingerprint(collected: CollectedControls): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(collected.controls) + collected.secretsFingerprint,
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export function requestFor(element: HTMLElement): { method: string; url: string } | undefined {
  if (element.tagName === 'A') return { method: 'GET', url: (element as HTMLAnchorElement).href };
  const control = element as HTMLButtonElement | HTMLInputElement;
  const form = control.type !== 'button' && control.type !== 'reset' ? control.form : null;
  if (!form) return undefined;
  const method = (control.getAttribute('formmethod') ?? form.method).toUpperCase();
  const url = new URL(
    control.getAttribute('formaction') ?? form.action,
    element.ownerDocument.baseURI,
  );
  if (method === 'GET') {
    const data = new FormData(form, control);
    url.search = new URLSearchParams(
      [...data].filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ).toString();
  }
  return { method, url: url.href };
}

export function collectWait(document: Document): {
  duration_ms?: number;
  fingerprint: string;
  expires_at_ms?: number;
} {
  const timers = allElements(document).filter(
    (el) =>
      isVisible(el) &&
      (el.matches('[class*="countdown"],[id*="countdown"],[data-countdown],[role=timer]') ||
        (el.matches('button:disabled,input:disabled,[aria-disabled="true"]') &&
          /download|télécharger|descargar|下载|تنزيل/i.test(el.textContent ?? ''))),
  );
  const duration = countdownDuration(
    timers.map((el) => ({
      text: (el.getAttribute('data-countdown') ?? el.textContent ?? '').trim(),
      visible: true,
    })),
  );
  const expiry = timers
    .map((el) => Date.parse(el.getAttribute('data-expires-at') ?? ''))
    .filter(Number.isFinite);
  return {
    ...(duration !== null ? { duration_ms: duration } : {}),
    fingerprint: 'countdown:' + timers.map(identity).join(','),
    ...(expiry.length ? { expires_at_ms: Math.min(...expiry) } : {}),
  };
}
