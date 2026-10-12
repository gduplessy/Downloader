import { describe, it, expect, vi } from 'vitest';
import { armChromium, originalResponseMetadata, takeFirefox, type DebuggerAPI } from './capture';
import type { DurableStreamSink } from './transport';
function fixture() {
  let event: (source: any, method: string, params: any) => void = () => {};
  const send = vi.fn(async (_target: any, method: string) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
    if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'original' };
    if (method === 'IO.read') return { base64Encoded: true, data: 'AQID', eof: true };
    return {};
  });
  const api: DebuggerAPI = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: send,
    onEvent: {
      addListener: (fn) => {
        event = fn;
      },
      removeListener: vi.fn(),
    },
    onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  const sink = {
    chunk: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  } as unknown as DurableStreamSink;
  return {
    api,
    sink,
    send,
    emit: (params: any) => event({ tabId: 5 }, 'Fetch.requestPaused', params),
  };
}
const response = {
  requestId: 'one',
  frameId: 'main',
  request: { url: 'https://file.test/action', method: 'POST' },
  responseStatusCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/octet-stream' }],
};
describe('original response takeover', () => {
  it('admits metadata before takeover, reads sequentially and terminates with a 204', async () => {
    const f = fixture();
    const admit = vi.fn(async () => {});
    const states: string[] = [];
    await armChromium(
      f.api,
      5,
      { url: response.request.url, method: 'POST' },
      f.sink,
      async (state) => {
        states.push(state);
      },
      admit,
    );
    f.emit(response);
    await vi.waitFor(() => expect(states).toContain('complete'));
    expect(admit).toHaveBeenCalledWith({ 'content-type': 'application/octet-stream' });
    expect(f.sink.chunk).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(f.send.mock.calls.map((c: unknown[]) => c[1])).toContain('Fetch.fulfillRequest');
    expect(f.sink.end).toHaveBeenCalledOnce();
  });
  it('returns navigation HTML to the browser without taking bytes or completing a file', async () => {
    const f = fixture();
    await armChromium(
      f.api,
      5,
      { url: response.request.url, method: 'POST' },
      f.sink,
      async () => {},
    );
    f.emit({ ...response, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }] });
    await vi.waitFor(() => expect(f.sink.abort).toHaveBeenCalled());
    expect(f.send.mock.calls.map((c: unknown[]) => c[1])).not.toContain('Fetch.takeResponseBodyAsStream');
    expect(f.sink.end).not.toHaveBeenCalled();
  });
  it('correlates redirects from the approved request and ignores foreign frame events', async () => {
    const f = fixture();
    await armChromium(
      f.api,
      5,
      { url: response.request.url, method: 'POST' },
      f.sink,
      async () => {},
    );
    f.emit({ ...response, frameId: 'foreign' });
    await vi.waitFor(() =>
      expect(f.send.mock.calls.map((c: unknown[]) => c[1])).toContain('Fetch.continueRequest'),
    );
    expect(f.sink.chunk).not.toHaveBeenCalled();
    f.emit({
      ...response,
      responseStatusCode: 302,
      responseHeaders: [{ name: 'Location', value: '/file' }],
    });
    await new Promise((r) => setTimeout(r, 5));
    f.emit({
      ...response,
      requestId: 'redirect',
      request: { url: 'https://file.test/file', method: 'GET' },
    });
    await vi.waitFor(() => expect(f.sink.end).toHaveBeenCalledOnce());
  });
  it('does not use encoded Content-Length as decoded byte total', () => {
    expect(
      originalResponseMetadata({
        'content-length': '37',
        'content-encoding': 'gzip',
        'content-disposition': "attachment; filename*=UTF-8''original%20file.bin",
      }),
    ).toEqual({ filename: 'original file.bin', total: null });
    expect(
      originalResponseMetadata({
        'content-length': '3',
        'content-disposition': 'attachment; filename="original.bin"',
      }),
    ).toEqual({ filename: 'original.bin', total: 3 });
    expect(originalResponseMetadata({ 'content-length': '0' }).total).toBe(0);
  });
  it('suspends Firefox input until desktop durable ACK and explicitly closes after EOF', async () => {
    let release!: () => void;
    const sink = {
      chunk: vi.fn(() => new Promise<void>((r) => (release = r))),
      end: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    } as unknown as DurableStreamSink;
    const filter: any = { suspend: vi.fn(), resume: vi.fn(), close: vi.fn(), disconnect: vi.fn() };
    takeFirefox(filter, sink, () => {});
    filter.ondata({ data: new Uint8Array([1, 2, 3]).buffer });
    await vi.waitFor(() => expect(sink.chunk).toHaveBeenCalledOnce());
    expect(filter.suspend).toHaveBeenCalledOnce();
    expect(filter.resume).not.toHaveBeenCalled();
    filter.onstop();
    release();
    await vi.waitFor(() => expect(filter.close).toHaveBeenCalledOnce());
    expect(sink.end).toHaveBeenCalledOnce();
  });
});
