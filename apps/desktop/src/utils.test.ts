import { describe, it, expect } from 'vitest';
import { expandUrls, bytes } from '../../../packages/shared/src/utils';
import { dictionaries, en } from '../../../packages/shared/src/i18n';
import { translations } from '../../../packages/shared/src/translations';
describe('bulk URLs', () => {
  it('expands padded ranges and deduplicates', () =>
    expect(expandUrls('https://example.com/[009:011].zip\nhttps://example.com/009.zip')).toEqual([
      'https://example.com/009.zip',
      'https://example.com/010.zip',
      'https://example.com/011.zip',
    ]));
  it('rejects dangerous schemes and excessive ranges', () => {
    expect(() => expandUrls('javascript:alert(1)')).toThrow();
    expect(() => expandUrls('https://example.com/[1:20000]')).toThrow();
    expect(() => expandUrls('https://u:p@example.com/')).toThrow();
  });
});
it('six locales expose the same nonempty keys', () => {
  expect(Object.keys(translations).sort()).toEqual(Object.keys(en).sort());
  for (const dictionary of Object.values(dictionaries)) {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(dictionary).every(Boolean)).toBe(true);
  }
});
it('formats unknown and large byte counts', () => {
  expect(bytes(null)).toBe('—');
  expect(bytes(1024)).toBe('1.0 KB');
});
