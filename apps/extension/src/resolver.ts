import browser from 'webextension-polyfill';
import { decide, type Candidate } from './resolver-policy';
// Runs only in the top-level tab assigned to an explicit navigation job.
const visible = (el: Element) => {
  const s = getComputedStyle(el),
    r = el.getBoundingClientRect();
  return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
};
async function step() {
  const all = [
    ...document.querySelectorAll<HTMLElement>(
      'a[href],button,input[type=submit],input[type=button]',
    ),
  ];
  const candidates: Candidate[] = all.map((el) => ({
    text:
      el instanceof HTMLInputElement
        ? el.value
        : el.innerText || el.getAttribute('aria-label') || '',
    href: el instanceof HTMLAnchorElement ? el.href : undefined,
    visible: visible(el),
    disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    download: el.hasAttribute('download'),
    id: el.id,
  }));
  const challenge = [
    ...document.querySelectorAll(
      'input[type=password],iframe[src*="captcha"],[class*="captcha"],[id*="captcha"]',
    ),
  ].some(visible);
  const countdown = [
    ...document.querySelectorAll(
      '[class*="countdown"],[id*="countdown"],[data-countdown],[role=timer]',
    ),
  ].some((el) => visible(el) && /\b[1-9]\d*\b/.test(el.textContent ?? ''));
  const decision = decide(candidates, challenge, countdown);
  let request: { method: string; url: string } | undefined;
  if (decision.kind === 'click') {
    const control = all[decision.index!];
    if (control instanceof HTMLAnchorElement) request = { method: 'GET', url: control.href };
    else if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
      const form = control.form;
      if (form && !control.hasAttribute('formaction') && !control.hasAttribute('formmethod')) {
        const method = form.method.toUpperCase(),
          url = new URL(form.action);
        if (method === 'GET') {
          const data = new FormData(form, control);
          url.search = new URLSearchParams(
            [...data].filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          ).toString();
        }
        request = { method, url: url.href };
      }
    }
  }
  const reply: any = await browser.runtime.sendMessage({
    type: 'resolver_step',
    url: location.href,
    decision,
    request,
    fingerprint: location.href + '|' + candidates[decision.index ?? -1]?.text,
  });
  if (reply?.click && decision.kind === 'click') {
    all[decision.index!].click();
  }
  if (reply?.repeat) setTimeout(() => void step(), 1000);
}
// Avoid multiple loops if a tab's completion event arrives more than once.
const root = globalThis as typeof globalThis & {
  __downloaderResolver?: boolean;
};
if (!root.__downloaderResolver) {
  root.__downloaderResolver = true;
  browser.runtime.onMessage.addListener((message: any) => {
    if (message.type === 'resolver_continue') {
      void step().catch(() => {});
      return Promise.resolve(true);
    }
    return undefined;
  });
  void step().catch(() => {});
}
