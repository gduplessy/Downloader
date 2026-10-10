import { describe, it, expect } from 'vitest';
import { decide, navigationAvailable, type Candidate } from './resolver-policy';
const c = (text: string, other: Partial<Candidate> = {}): Candidate => ({
  text,
  visible: true,
  disabled: false,
  download: false,
  ...other,
});
describe('hosted-page decisions', () => {
  it('bounds bulk navigation and protects each host session until its current page finishes', () => {
    const pages = ['https://a.example/file1', 'https://b.example/file2'];
    expect(navigationAvailable(pages, 'https://a.example/file3')).toBe(false);
    expect(navigationAvailable(pages, 'https://c.example/file3')).toBe(true);
    expect(
      navigationAvailable([...pages, 'https://c.example/file3'], 'https://d.example/file4'),
    ).toBe(false);
    expect(navigationAvailable(pages.slice(1), 'https://a.example/file3')).toBe(true);
    expect(navigationAvailable([], 'file:///tmp/file')).toBe(false);
  });
  it('chooses the screenshot style free control while excluding premium and torrent', () => {
    expect(
      decide(
        [c('Start Download\nYour file is ready'), c('Premium Download'), c('Torrent')],
        false,
        false,
      ),
    ).toMatchObject({ kind: 'click', index: 0 });
  });
  it('respects countdowns and disabled controls', () => {
    expect(decide([c('Start Download')], false, true).kind).toBe('wait');
    expect(decide([c('Download', { disabled: true })], false, false).kind).toBe('wait');
  });
  it('stops for login, CAPTCHA, ambiguous controls and advertisements', () => {
    expect(decide([c('Download')], true, false).kind).toBe('user');
    expect(decide([c('Download'), c('Download')], false, false).kind).toBe('user');
    expect(decide([c('Download premium')], false, false).kind).toBe('user');
  });
  it('ignores hidden or unsafe links', () => {
    expect(
      decide(
        [c('Download', { href: 'javascript:evil()' }), c('Download', { visible: false })],
        false,
        false,
      ).kind,
    ).toBe('user');
  });
});
