import { allElements } from '../adapters/dom';
export interface DiscoveredLink {
  url: string;
  resource: boolean;
  name: string;
  size: number | null;
  content_type: string;
}
/** DOM-only inspection: never follow a link, submit a form, or fetch a resource. */
export async function extractRendered(
  doc: Document,
  quietMs = 500,
  timeoutMs = 10000,
): Promise<{ final_url: string; bytes: number; links: DiscoveredLink[]; reason: string | null }> {
  const start = Date.now();
  let changed = Date.now();
  const observer = new MutationObserver(() => {
    changed = Date.now();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  try {
    while (
      doc.readyState === 'loading' ||
      Date.now() - start < 1500 ||
      Date.now() - changed < quietMs ||
      !!doc.querySelector('[aria-busy=true],[data-loading=true]')
    ) {
      if (Date.now() - start >= timeoutMs)
        return { final_url: doc.URL, bytes: 0, links: [], reason: 'render_timeout' };
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    observer.disconnect();
  }
  if (doc.querySelector('input[type=password]'))
    return { final_url: doc.URL, bytes: 0, links: [], reason: 'authentication_required' };
  const result: DiscoveredLink[] = [];
  const seen = new Set<string>();
  for (const element of allElements(doc).filter((element) => element.matches('a[href],img[src],video[src],audio[src],source[src],link[href]'))) {
    const value = element.getAttribute('href') ?? element.getAttribute('src');
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value, doc.URL);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    url.hash = '';
    if (url.href.length > 2048 || seen.has(url.href)) continue;
    seen.add(url.href);
    const file = /\.[^/.]+$/.test(url.pathname) && !/\.(?:html?|php|aspx?)$/i.test(url.pathname);
    const resource = element.hasAttribute('download') || element.tagName !== 'A' || file;
    result.push({
      url: url.href,
      resource,
      name: (element.getAttribute('download') || url.pathname.split('/').pop() || 'download').slice(
        0,
        128,
      ),
      size: null,
      content_type: element.getAttribute('type') || '',
    });
    if (result.length >= 250) break;
  }
  const bytes = new TextEncoder().encode(doc.documentElement.outerHTML).byteLength;
  return {
    final_url: doc.URL,
    bytes,
    links: result,
    reason: bytes > 8 * 1024 * 1024 ? 'render_timeout' : null,
  };
}
