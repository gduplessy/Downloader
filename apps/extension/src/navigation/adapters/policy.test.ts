import { describe, expect, test } from 'vitest';
import { adapters, inspectCandidates, matchAdapter, sessionLockKey, type Control } from './policy';
import { createPreview, validateSelection, SubmissionGate, type PreviewBinding } from './preview';
import { previewLocales } from './selection-ui';
const page = 'http://127.0.0.1:18765/nav-adapters/g4u/chosen-host';
const c = (id: string, overrides: Partial<Control> = {}): Control => ({
  localId: id,
  text: 'Download',
  href: 'https://ddownload.com/file.zip',
  target: 'https://ddownload.com/file.zip',
  visible: true,
  disabled: false,
  download: false,
  action: 'link',
  order: 0,
  ...overrides,
});
const bound: PreviewBinding = {
  tabId: 4,
  frameId: 0,
  sessionKey: 'profile-a',
  claimGeneration: 2,
  documentGeneration: 1,
  page,
  adapterId: 'local-fixture',
  adapterVersion: '1.0.0',
  fingerprint: 'sha256-local-dom',
};

describe('versioned exact-host adapters', () => {
  test('exact host and fixture path matching does not accept lookalike suffixes', () => {
    expect(matchAdapter('https://ddownload.com/a').id).toBe('ddownload');
    for (const url of [
      'https://ddownload.com.evil/a',
      'https://evil-ddownload.com/a',
      'https://sub.gofile.io/d/a',
      'javascript:alert(1)',
      'https://user:secret@gofile.io/d/a',
    ])
      expect(matchAdapter(url).id).toBe('generic');
    expect(matchAdapter(page).id).toBe('local-fixture');
    expect(matchAdapter('http://localhost/nav-adapters/g4uevil/')).toMatchObject({ id: 'generic' });
  });
  test('each real provider is explicitly unqualified and disable is independent', () => {
    expect(adapters.filter((a) => a.qualification === 'unqualified').map((a) => a.id)).toEqual([
      'g4u',
      'ddownload',
      'rapidgator',
      'gofile',
    ]);
    expect(matchAdapter('https://rapidgator.net/file/a', ['rapidgator']).id).toBe('generic');
    expect(matchAdapter('https://gofile.io/d/a', ['rapidgator']).id).toBe('gofile');
    expect(sessionLockKey('https://ddownload.com/a', 'scope-a')).not.toBe(
      sessionLockKey('https://ddownload.com/a', 'scope-b'),
    );
  });
});
describe('candidate evidence and deterministic selection', () => {
  test('one eligible recognized control is selected', () => {
    expect(inspectCandidates(page, [c('download')])).toMatchObject({
      kind: 'click',
      selected: { localId: 'download', confidence: 'strong' },
    });
  });
  test('duplicates never auto-click even when strong', () => {
    expect(inspectCandidates(page, [c('one'), c('two')]).kind).toBe('preview');
  });
  test.each(['Premium download', 'Download torrent', 'Buy now', 'Sponsored download'])(
    'rejects %s',
    (text) => {
      const result = inspectCandidates(page, [c('bad', { text }), c('good')]);
      expect(result.selected?.localId).toBe('good');
      expect(result.candidates[0].confidence).toBe('rejected');
    },
  );
  test.each([
    'magnet:?xt=abc',
    'javascript:alert(1)',
    'data:application/octet-stream,x',
    'https://a:secret@example.org/file',
  ])('rejects unsafe destination %s', (target) => {
    expect(inspectCandidates(page, [c('bad', { target, href: target })]).kind).toBe('user');
  });
  test('hidden, ad context and disabled controls cannot be selected', () => {
    expect(inspectCandidates(page, [c('hidden', { visible: false })]).kind).toBe('user');
    expect(
      inspectCandidates(page, [c('ad', { contextualText: 'advertisement sponsor' })]).kind,
    ).toBe('user');
    expect(inspectCandidates(page, [c('wait', { disabled: true })]).kind).toBe('wait');
    expect(inspectCandidates(page, [c('wait', { disabled: true }), c('ready')]).kind).toBe(
      'preview',
    );
  });
  test('localized labels are offered explicitly without inventing host confidence', () => {
    for (const text of [
      'Télécharger',
      'Descargar archivo',
      'Herunterladen',
      '下载文件',
      'تنزيل الملف',
    ])
      expect(inspectCandidates('https://gofile.io/d/a', [c('localized', { text })]).kind).toBe(
        'preview',
      );
  });
  test('fixture-only structural evidence cannot qualify real hosts', () => {
    const candidate = c('marked', { text: 'Retrieve archive', fixture: true });
    expect(inspectCandidates(page, [candidate]).kind).toBe('click');
    expect(inspectCandidates('https://gofile.io/d/a', [candidate]).kind).toBe('user');
  });
  test('selected downstream host excludes other providers and preserves ordered link groups', () => {
    const controls = [
      c('rg1', {
        panelHost: 'rapidgator.net',
        target: 'https://rapidgator.net/file/1',
        group: 'rg',
        order: 0,
      }),
      c('dd1', { panelHost: 'ddownload.com', group: 'dd', order: 1 }),
      c('dd2', { panelHost: 'ddownload.com', group: 'dd', order: 2 }),
    ];
    const result = inspectCandidates(page, controls, { selectedHost: 'ddownload.com' });
    expect(result.kind).toBe('preview');
    expect(
      result.candidates
        .filter((candidate) => candidate.confidence !== 'rejected')
        .map((candidate) => [candidate.localId, candidate.group, candidate.order]),
    ).toEqual([
      ['dd1', 'dd', 1],
      ['dd2', 'dd', 2],
    ]);
  });
  test('challenge and countdown override actionable controls', () => {
    expect(inspectCandidates(page, [c('a')], { blocked: true }).kind).toBe('user');
    expect(inspectCandidates(page, [c('a')], { countdown: true }).kind).toBe('wait');
  });
});
describe('preview ownership and stale submission', () => {
  const inspection = inspectCandidates(page, [c('a'), c('b')]);
  test('valid explicit choice resolves deterministic control', () => {
    expect(
      validateSelection(createPreview(bound, inspection), bound, inspection, 'b').localId,
    ).toBe('b');
  });
  test.each(Object.keys(bound) as (keyof PreviewBinding)[])('rejects changed %s', (key) => {
    const changed = { ...bound, [key]: typeof bound[key] === 'number' ? 99 : 'changed' };
    expect(() =>
      validateSelection(createPreview(bound, inspection), changed, inspection, 'a'),
    ).toThrow('adapter_preview_stale');
  });
  test('same-label replacement, unsafe destination and disabled controls require refreshed preview', () => {
    for (const controls of [
      [c('replacement'), c('b')],
      [c('a', { target: 'javascript:alert(1)' }), c('b')],
      [c('a', { disabled: true }), c('b')],
    ])
      expect(() =>
        validateSelection(
          createPreview(bound, inspection),
          bound,
          inspectCandidates(page, controls),
          'a',
        ),
      ).toThrow('adapter_preview_stale');
  });
  test('one authorization is consumed only once', () => {
    const gate = new SubmissionGate();
    gate.consume(bound, 'a');
    expect(() => gate.consume(bound, 'a')).toThrow('adapter_already_submitted');
  });
  test('preview has all six locale dictionaries', () =>
    expect(previewLocales.sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'zh-CN']));
});
