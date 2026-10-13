import { decide, type Candidate } from '../../resolver-policy';

export const ADAPTER_VERSION = '1.0.0';
export type Provider = 'g4u' | 'ddownload' | 'rapidgator' | 'gofile';
export type Control = Candidate & {
  localId: string;
  action: 'link' | 'GET' | 'POST' | 'script';
  target?: string;
  panelHost?: string;
  group?: string;
  order: number;
  fixture?: boolean;
  premium?: boolean;
  contextualText?: string;
};
export type EvidenceCandidate = Control & {
  destinationHost?: string;
  confidence: 'strong' | 'possible' | 'rejected';
  evidence: string[];
  rejections: string[];
};
export type Adapter = {
  id: string;
  version: string;
  hosts: readonly string[];
  paths: readonly RegExp[];
  qualification: 'synthetic' | 'unqualified' | 'generic';
  capabilities: readonly string[];
  sessionSensitive: boolean;
};
const providers: Record<Provider, readonly string[]> = {
  g4u: ['g4u.to'],
  ddownload: ['ddownload.com', 'www.ddownload.com'],
  rapidgator: ['rapidgator.net', 'www.rapidgator.net'],
  gofile: ['gofile.io'],
};
export const adapters: readonly Adapter[] = [
  ...Object.entries(providers).map(([id, hosts]) => ({
    id,
    version: ADAPTER_VERSION,
    hosts,
    paths: [/^\//],
    qualification: 'unqualified' as const,
    capabilities: ['candidate-preview', 'selected-host'],
    sessionSensitive: true,
  })),
  {
    id: 'local-fixture',
    version: ADAPTER_VERSION,
    hosts: ['127.0.0.1', 'localhost', '[::1]'],
    paths: [/^\/nav-adapters\/(?:g4u|ddownload|rapidgator|gofile)(?:\/|$)/],
    qualification: 'synthetic',
    capabilities: ['candidate-preview', 'selected-host', 'get', 'post'],
    sessionSensitive: true,
  },
  {
    id: 'generic',
    version: ADAPTER_VERSION,
    hosts: [],
    paths: [/^\//],
    qualification: 'generic',
    capabilities: ['candidate-preview', 'get', 'post'],
    sessionSensitive: true,
  },
];
export function matchAdapter(url: string, disabled: readonly string[] = []): Adapter {
  const generic = adapters[adapters.length - 1];
  try {
    const page = new URL(url);
    if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password)
      return generic;
    return (
      adapters.find(
        (a) =>
          !disabled.includes(a.id) &&
          a.hosts.includes(page.hostname) &&
          a.paths.some((p) => p.test(page.pathname)),
      ) ?? generic
    );
  } catch {
    return generic;
  }
}
export function sessionLockKey(url: string, scopeKey: string): string {
  return scopeKey + '|' + new URL(url).hostname.toLowerCase();
}
const forbidden =
  /premium|torrent|magnet:|subscribe|subscription|purchase|buy\b|pay\b|advert|sponsor/i;
const localizedDownload =
  /^(?:télécharger(?: le fichier)?|descargar(?: archivo)?|herunterladen|下载(?:文件)?|تنزيل(?: الملف)?)$/i;
function safeUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u : undefined;
  } catch {
    return undefined;
  }
}
export type Inspection = {
  adapter: Adapter;
  candidates: EvidenceCandidate[];
  selected?: EvidenceCandidate;
  kind: 'click' | 'preview' | 'wait' | 'user';
  reason: string;
  selectedHost?: string;
};
export function inspectCandidates(
  url: string,
  controls: readonly Control[],
  options: {
    disabledAdapters?: readonly string[];
    selectedHost?: string;
    blocked?: boolean;
    countdown?: boolean;
    allowPageBlob?: boolean;
    allowPremium?: boolean;
  } = {},
): Inspection {
  const adapter = matchAdapter(url, options.disabledAdapters);
  const selectedHost = options.selectedHost?.toLowerCase();
  const candidates = controls.map((c): EvidenceCandidate => {
    const target = c.target ?? c.href;
    const destination = safeUrl(target);
    let blob: URL | undefined;
    try {
      const candidate = target ? new URL(target) : undefined;
      if (
        options.allowPageBlob &&
        candidate?.protocol === 'blob:' &&
        candidate.origin === new URL(url).origin
      )
        blob = candidate;
    } catch {}
    const rejections: string[] = [];
    const evidence: string[] = [];
    if (!c.visible) rejections.push('hidden');
    if (c.disabled) rejections.push('disabled');
    const premiumAuthorized =
      options.allowPremium === true &&
      adapter.qualification === 'synthetic' &&
      c.premium === true &&
      c.fixture === true;
    const forbiddenText = premiumAuthorized
      ? [c.text, c.contextualText, target].join(' ').replace(/premium/gi, '')
      : [c.text, c.contextualText, target].join(' ');
    if (forbidden.test(forbiddenText)) rejections.push('ad-purchase-premium-or-torrent');
    if (target && !destination && !blob) rejections.push('unsafe-destination');
    if (blob) evidence.push('same-origin-scoped-blob');
    if (premiumAuthorized) evidence.push('qualified-selected-session-entitlement');
    if (c.premium && !premiumAuthorized) rejections.push('premium-entitlement-required');
    if (
      selectedHost &&
      c.panelHost?.toLowerCase() !== selectedHost &&
      destination?.hostname.toLowerCase() !== selectedHost
    )
      rejections.push('different-selected-host');
    const generic =
      decide([{ ...c, href: blob ? undefined : c.href, disabled: false }], false, false).kind ===
      'click';
    const localized = localizedDownload.test(c.text.trim());
    if (generic) evidence.push(c.download ? 'download-attribute' : 'recognized-free-control');
    if (localized) evidence.push('localized-download-label');
    const fixtureStrong =
      adapter.qualification === 'synthetic' &&
      c.fixture === true &&
      !!destination &&
      ['link', 'GET', 'POST'].includes(c.action);
    if (fixtureStrong) evidence.push('synthetic-versioned-control-and-request');
    if (c.panelHost) evidence.push('ordered-host-panel');
    if (!generic && !localized && !fixtureStrong && !c.panelHost)
      rejections.push('unrecognized-control');
    // Live providers have no permitted recorded layout yet: conservative generic policy only.
    const strong = !blob && c.action !== 'script' && ((generic && !localized) || fixtureStrong);
    return {
      ...c,
      destinationHost: destination?.hostname ?? (blob ? new URL(url).hostname : undefined),
      rejections,
      evidence,
      confidence: rejections.length ? 'rejected' : strong ? 'strong' : 'possible',
    };
  });
  if (options.blocked)
    return {
      adapter,
      candidates,
      kind: 'user',
      reason: 'Complete the current browser challenge or login.',
      selectedHost,
    };
  if (options.countdown)
    return {
      adapter,
      candidates,
      kind: 'wait',
      reason: 'Waiting for the site countdown.',
      selectedHost,
    };
  const eligible = candidates.filter((c) => c.confidence !== 'rejected');
  const waiting = candidates.some(
    (c) => c.rejections.length === 1 && c.rejections[0] === 'disabled',
  );
  if (eligible.length === 1 && eligible[0].confidence === 'strong' && !waiting)
    return {
      adapter,
      candidates,
      selected: eligible[0],
      kind: 'click',
      reason: 'Following the identified download control.',
      selectedHost: eligible[0].panelHost ?? selectedHost,
    };
  if (eligible.length)
    return {
      adapter,
      candidates,
      kind: 'preview',
      reason: 'Select the intended download control.',
      selectedHost,
    };
  return {
    adapter,
    candidates,
    kind: waiting ? 'wait' : 'user',
    reason: waiting
      ? 'Waiting for the download control.'
      : 'No supported download control. Continue manually in the browser.',
    selectedHost,
  };
}
