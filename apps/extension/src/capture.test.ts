import { it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { eligible, defaults, excluded, handoff, sitePattern, type HandoffAdapter } from './capture';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const item = {
  id: 7,
  url: 'https://example.com/file.zip',
  filename: 'file.zip',
  state: 'in_progress',
};
it('requests a single HTTP host and rejects embedded credentials or local files', () => {
  expect(sitePattern('http://127.0.0.1:8129/hosted')).toBe('http://127.0.0.1/*');
  expect(sitePattern('https://downloads.example.com/path')).toBe('https://downloads.example.com/*');
  expect(() => sitePattern('file:///tmp/file')).toThrow();
  expect(() => sitePattern('https://user:secret@example.com/file')).toThrow();
});
it('captures only known replayable GET downloads', () => {
  const s = { ...defaults, automatic: true };
  expect(eligible(item, s, 'GET')).toBe(true);
  expect(eligible(item, s, 'POST')).toBe(false);
  expect(eligible(item, s)).toBe(false);
  expect(eligible({ ...item, url: 'blob:abc' }, s, 'GET')).toBe(false);
  expect(eligible({ ...item, state: 'complete' }, s, 'GET')).toBe(false);
});
it('domain exclusions do not match unrelated suffixes', () => {
  expect(excluded('https://a.example.com/x', ['*.example.com'])).toBe(true);
  expect(excluded('https://badexample.com/x', ['*.example.com'])).toBe(false);
});
function adapter(): HandoffAdapter {
  return {
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    create: vi.fn(async () => ({
      id: 'native',
      state: 'downloading',
      viable: true,
    })),
    job: vi.fn(async () => ({
      id: 'native',
      state: 'downloading',
      viable: true,
    })),
    cancelNative: vi.fn(async () => {}),
    pending: vi.fn(async () => {}),
    wait: vi.fn(async () => {}),
    deadline: 400,
  };
}
it('cancels the browser only after viable desktop acceptance', async () => {
  const a = adapter();
  expect(await handoff(item, a)).toBe('desktop');
  expect(a.pause).toHaveBeenCalled();
  expect(a.cancel).toHaveBeenCalled();
  expect(a.resume).not.toHaveBeenCalled();
});
it('resumes the browser when the native host is missing', async () => {
  const a = adapter();
  a.create = vi.fn(async () => {
    throw Error('absent');
  });
  expect(await handoff(item, a)).toBe('browser');
  expect(a.cancel).not.toHaveBeenCalled();
  expect(a.resume).toHaveBeenCalled();
});
it('cancels unaccepted native work and resumes on timeout', async () => {
  const a = adapter();
  a.create = vi.fn(async () => ({
    id: 'native',
    state: 'queued',
    viable: false,
  }));
  a.job = a.create as any;
  expect(await handoff(item, a)).toBe('browser');
  expect(a.cancelNative).toHaveBeenCalledWith('native');
  expect(a.cancel).not.toHaveBeenCalled();
  expect(a.resume).toHaveBeenCalled();
});
it('keeps a pending record if browser fallback itself fails', async () => {
  const a = adapter();
  a.create = vi.fn(async () => {
    throw Error('absent');
  });
  a.resume = vi.fn(async () => {
    throw Error('browser closed');
  });
  await expect(handoff(item, a)).rejects.toThrow();
  expect(a.pending).not.toHaveBeenCalledWith(null);
});
