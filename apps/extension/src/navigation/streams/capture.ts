import { STREAM_CHUNK_BYTES } from '../../../../../packages/shared/src/navigation';
import type { DurableStreamSink } from './transport';
export interface DebuggerAPI {
  attach(target: { tabId: number }, version: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(target: { tabId: number }, method: string, params?: any): Promise<any>;
  onEvent: {
    addListener(fn: (source: any, method: string, params: any) => void): void;
    removeListener(fn: (source: any, method: string, params: any) => void): void;
  };
  onDetach: {
    addListener(fn: (source: any, reason: string) => void): void;
    removeListener(fn: (source: any, reason: string) => void): void;
  };
}
export type CaptureState =
  'armed' | 'taking_original_response' | 'streaming' | 'complete' | 'interrupted' | 'detached';
export async function armChromium(
  api: DebuggerAPI,
  tabId: number,
  action: { url: string; method: string },
  sink: DurableStreamSink,
  state: (state: CaptureState) => Promise<void>,
  admit: (headers: Record<string, string>) => Promise<void> = async () => {},
): Promise<() => Promise<void>> {
  const target = { tabId };
  let expected = new URL(action.url).href;
  let taken = false;
  let ended = false;
  let redirected = false;
  await api.attach(target, '1.3');
  let frameId: string;
  try {
    frameId = (await api.sendCommand(target, 'Page.getFrameTree')).frameTree.frame.id;
  } catch (error) {
    await api.detach(target);
    throw error;
  }
  let deadline: ReturnType<typeof setTimeout> | undefined;
  async function cleanup() {
    if (ended) return;
    clearTimeout(deadline);
    ended = true;
    api.onEvent.removeListener(onEvent);
    api.onDetach.removeListener(onDetach);
    await api.detach(target).catch(() => {});
  }
  const onDetach = (source: any, _reason: string) => {
    if (source.tabId !== tabId || ended) return;
    clearTimeout(deadline);
    ended = true;
    api.onEvent.removeListener(onEvent);
    api.onDetach.removeListener(onDetach);
    void sink.abort('debugger_detached').catch(() => {});
    void state('detached');
  };
  const onEvent = (source: any, method: string, event: any) => {
    if (source.tabId !== tabId || method !== 'Fetch.requestPaused') return;
    void (async () => {
      if (ended || event.frameId !== frameId || event.request.url !== expected) {
        await api.sendCommand(target, 'Fetch.continueRequest', { requestId: event.requestId });
        return;
      }
      if (!redirected && event.request.method !== action.method) {
        await api.sendCommand(target, 'Fetch.continueRequest', { requestId: event.requestId });
        return;
      }
      const headers = Object.fromEntries(
        (event.responseHeaders ?? []).map((h: any) => [h.name.toLowerCase(), h.value]),
      );
      if (event.responseStatusCode >= 300 && event.responseStatusCode < 400 && headers.location) {
        redirected = true;
        expected = new URL(String(headers.location), expected).href;
        await api.sendCommand(target, 'Fetch.continueRequest', { requestId: event.requestId });
        return;
      }
      if (
        event.responseStatusCode !== 200 ||
        (!/attachment/i.test(String(headers['content-disposition'] ?? '')) &&
          /(?:text\/html|json)/i.test(String(headers['content-type'] ?? '')))
      ) {
        await api.sendCommand(target, 'Fetch.continueRequest', { requestId: event.requestId });
        await sink.abort('non_file_response');
        await cleanup();
        return;
      }
      if (taken) throw Error('Original response already captured');
      await admit(headers as Record<string, string>);
      await state('taking_original_response');
      const { stream } = await api.sendCommand(target, 'Fetch.takeResponseBodyAsStream', {
        requestId: event.requestId,
      });
      taken = true;
      await state('streaming');
      try {
        for (;;) {
          const part = await api.sendCommand(target, 'IO.read', {
            handle: stream,
            size: STREAM_CHUNK_BYTES,
          });
          const text = part.base64Encoded ? atob(part.data) : part.data;
          const bytes = part.base64Encoded
            ? Uint8Array.from(text, (c: string) => c.charCodeAt(0))
            : new TextEncoder().encode(text);
          if (bytes.length) await sink.chunk(bytes);
          if (part.eof) break;
        }
        await sink.end();
        // Stream takeover cannot continue the original response. Complete with an empty response.
        await api.sendCommand(target, 'Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 204,
          body: '',
        });
        await state('complete');
      } finally {
        await api.sendCommand(target, 'IO.close', { handle: stream }).catch(() => {});
        await cleanup();
      }
    })().catch(async () => {
      await sink.abort(taken ? 'original_response_interrupted' : 'capture_failed').catch(() => {});
      await state('interrupted');
      await cleanup();
    });
  };
  api.onEvent.addListener(onEvent);
  api.onDetach.addListener(onDetach);
  try {
    await api.sendCommand(target, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Response' }],
    });
    await state('armed');
  } catch (error) {
    await cleanup();
    await sink.abort('attachment_refused').catch(() => {});
    throw error;
  }
  deadline = setTimeout(() => {
    if (!taken) {
      void sink.abort('unused_action').catch(() => {});
      void cleanup();
    }
  }, 60000);
  return async () => {
    await sink.abort('cancelled').catch(() => {});
    await cleanup();
  };
}
export interface FirefoxFilter {
  ondata: ((event: { data: ArrayBuffer }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  write(bytes: ArrayBuffer): void;
  close(): void;
  disconnect(): void;
  suspend(): void;
  resume(): void;
}
export function takeFirefox(
  filter: FirefoxFilter,
  sink: DurableStreamSink,
  onError: () => void,
  admission: Promise<boolean> = Promise.resolve(true),
  onComplete: (completed: boolean) => void = () => {},
): void {
  let queue = admission.then((accepted) => {
    if (!accepted) {
      failed = true;
      try { filter.disconnect(); } catch {}
      onComplete(false);
    }
  });
  let failed = false;
  let queuedBytes = 0;
  const abort = () => {
    if (failed) return;
    failed = true;
    // A failed filter may itself reject disconnect; native recovery must still run.
    try { filter.disconnect(); } catch {}
    void sink.abort('filter_interrupted').catch(() => {});
    onError();
  };
  filter.ondata = (event) => {
    if (failed) return;
    if (queuedBytes + event.data.byteLength > STREAM_CHUNK_BYTES * 2) {
      abort();
      return;
    }
    queuedBytes += event.data.byteLength;
    filter.suspend();
    queue = queue
      .then(async () => {
        try {
          if (failed) return;
          await sink.chunk(new Uint8Array(event.data));
          filter.resume();
        } finally {
          queuedBytes -= event.data.byteLength;
        }
      })
      .catch(abort);
  };
  filter.onstop = () => {
    void queue
      .then(async () => {
        if (failed) return;
        await sink.end();
        filter.close();
        onComplete(true);
      })
      .catch(abort);
  };
  filter.onerror = abort;
  // Explicit direct takeover: bytes are delivered to desktop, not buffered into the browser download.
}

export function originalResponseMetadata(headers: Record<string, string>): {
  filename?: string;
  total: number | null;
} {
  const disposition = headers['content-disposition'] ?? '';
  let filename: string | undefined;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded[1].trim());
    } catch {}
  }
  if (!filename) {
    const plain = /filename\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))/i.exec(disposition);
    filename = plain?.[1] ?? plain?.[2]?.trim();
  }
  if (filename && (filename.length > 1024 || /[\r\n\0]/.test(filename))) filename = undefined;
  const length = Number(headers['content-length']);
  const encodedBody = Boolean(
    headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity',
  );
  return {
    filename,
    total:
      !encodedBody && /^\d+$/.test(headers['content-length'] ?? '') && Number.isSafeInteger(length)
        ? length
        : null,
  };
}
