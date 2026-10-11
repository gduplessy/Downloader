import { describe, it, expect } from 'vitest';
import {
  decide,
  navigationAvailable,
  classifyBlocker,
  shouldSolve,
  type Candidate,
} from './resolver-policy';
const c = (text: string, other: Partial<Candidate> = {}): Candidate => ({
  text,
  visible: true,
  disabled: false,
  download: false,
  ...other,
});
describe('hosted-page decisions', () => {
  it('distinguishes expiry, authentication, custom CAPTCHA, and browser protection', () => {
    const signals = {
      text: '',
      password: false,
      captcha: false,
      browserChallenge: false,
      countdown: false,
    };
    expect(
      classifyBlocker({ ...signals, text: 'Link expired. Solve the captcha', captcha: true }),
    ).toBe('expired');
    expect(classifyBlocker({ ...signals, password: true, captcha: true })).toBe('authentication');
    expect(classifyBlocker({ ...signals, captcha: true })).toBe('captcha');
    expect(classifyBlocker({ ...signals, browserChallenge: true })).toBe('browser_challenge');
    expect(classifyBlocker({ ...signals, text: 'HTTP 403 Forbidden' })).toBeUndefined();
  });
  it('automates only opted-in direct anonymous browser challenges once', () => {
    expect(shouldSolve('browser_challenge', true, true, false, false)).toBe(true);
    for (const blocker of ['captcha', 'authentication', 'expired', 'countdown', undefined] as const)
      expect(shouldSolve(blocker, true, true, false, false)).toBe(false);
    expect(shouldSolve('browser_challenge', false, true, false, false)).toBe(false);
    expect(shouldSolve('browser_challenge', true, false, false, false)).toBe(false);
    expect(shouldSolve('browser_challenge', true, true, true, false)).toBe(false);
    expect(shouldSolve('browser_challenge', true, true, false, true)).toBe(false);
  });
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
