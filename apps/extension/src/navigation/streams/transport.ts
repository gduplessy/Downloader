import browser from 'webextension-polyfill';
import {
  NATIVE_FRAME_LIMIT,
  STREAM_CHUNK_BYTES,
  type StreamOperation,
  type StreamIdentity,
  type StreamAck,
  type NavigationTarget,
} from '../../../../../packages/shared/src/navigation';
interface WirePort {
  postMessage(value: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (value: any) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}
export class NativeStreamPort {
  private port?: WirePort;
  private pending = new Map<
    string,
    {
      resolve: (value: StreamAck) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private connect: () => WirePort = () => browser.runtime.connectNative('org.downloader.native'),
  ) {}
  private open(): WirePort {
    if (this.port) return this.port;
    const port = this.connect();
    this.port = port;
    port.onMessage.addListener((response) => {
      const waiter = this.pending.get(response.id);
      if (!waiter) return;
      this.pending.delete(response.id);
      clearTimeout(waiter.timer);
      if (response.version !== 1 || response.ok !== true)
        waiter.reject(Error(response.error?.message ?? 'Invalid stream acknowledgement'));
      else waiter.resolve(response.data);
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = undefined;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(Error('Native stream disconnected'));
      }
      this.pending.clear();
    });
    return port;
  }
  async operation(operation: StreamOperation): Promise<StreamAck> {
    const id = crypto.randomUUID();
    const frame = { version: 1, id, command: 'browser_stream', args: operation };
    if (new TextEncoder().encode(JSON.stringify(frame)).length >= NATIVE_FRAME_LIMIT)
      throw Error('Native frame exceeds negotiated limit');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('Durable stream acknowledgement timed out'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.open().postMessage(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  close() {
    this.port?.disconnect();
    this.port = undefined;
  }
}
export function base64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export class DurableStreamSink {
  offset = 0;
  peakBufferedBytes = 0;
  terminal = false;
  constructor(
    readonly identity: StreamIdentity,
    private port: NativeStreamPort,
    private verifyOwner: () => Promise<void>,
    private onTerminal: () => void = () => {},
  ) {}
  private validate(ack: StreamAck, expected: number) {
    if (
      ack.stream_id !== this.identity.stream_id ||
      ack.claim_generation !== this.identity.scope.claim_generation ||
      ack.source_generation !== this.identity.source_generation ||
      ack.accepted_offset !== expected
    )
      throw Error('Stale or invalid durable acknowledgement');
  }
  async begin(target: NavigationTarget, filename: string, total: number | null) {
    await this.verifyOwner();
    const ack = await this.port.operation({
      ...this.identity,
      operation: 'begin',
      target,
      filename,
      total,
    });
    this.offset = ack.accepted_offset;
    this.validate(ack, this.offset);
  }
  async chunk(bytes: Uint8Array) {
    // A single outstanding frame bounds transport memory and propagates durable backpressure.
    for (let index = 0; index < bytes.length; index += STREAM_CHUNK_BYTES) {
      const part = bytes.subarray(index, index + STREAM_CHUNK_BYTES);
      this.peakBufferedBytes = Math.max(this.peakBufferedBytes, part.byteLength);
      await this.verifyOwner();
      const operation: StreamOperation = {
        ...this.identity,
        operation: 'chunk',
        offset: this.offset,
        data_base64: base64(part),
      };
      let ack: StreamAck;
      try {
        ack = await this.port.operation(operation);
      } catch (error) {
        if (!String(error).includes('disconnected')) throw error;
        // Only retransmit retained bytes after a lost ACK; service compares existing bytes.
        await this.verifyOwner();
        ack = await this.port.operation(operation);
      }
      this.validate(ack, this.offset + part.length);
      this.offset += part.length;
    }
  }
  async end() {
    await this.verifyOwner();
    const ack = await this.port.operation({
      ...this.identity,
      operation: 'end',
      total: this.offset,
      expected_sha256: null,
    });
    this.validate(ack, this.offset);
    if (!ack.terminal) throw Error('Stream verification did not complete');
    this.terminal = true;
    this.port.close();
    this.onTerminal();
  }
  async abort(reason = 'interrupted') {
    try {
      await this.verifyOwner();
      await this.port.operation({ ...this.identity, operation: 'abort', reason });
    } finally {
      this.terminal = true;
      this.port.close();
      this.onTerminal();
    }
  }
}
