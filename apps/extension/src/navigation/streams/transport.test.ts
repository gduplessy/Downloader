import { describe, it, expect, vi } from 'vitest';
vi.mock('webextension-polyfill', () => ({ default: { runtime: {} } }));
import { DurableStreamSink, NativeStreamPort } from './transport';
import {
  STREAM_CHUNK_BYTES,
  type StreamOperation,
} from '../../../../../packages/shared/src/navigation';
const identity = {
  stream_id: crypto.randomUUID(),
  scope: {
    browser: 'chromium',
    profile: crypto.randomUUID(),
    private: false,
    cookie_store_id: '0',
    container_id: null,
    partition_key: null,
    claim_generation: 1,
  },
  source_generation: 1,
};
describe('persistent bounded durable native transport', () => {
  it('aborts a native checkpoint admitted after cancellation without accepting bytes', async () => {
    let release!: (ack: any) => void;
    const admitted = new Promise<any>((resolve) => {
      release = resolve;
    });
    const operations: StreamOperation[] = [];
    const operation = vi.fn((value: StreamOperation) => {
      operations.push(value);
      return value.operation === 'begin'
        ? admitted
        : Promise.resolve({
            ...identity,
            claim_generation: 1,
            accepted_offset: 0,
            terminal: true,
          });
    });
    const sink = new DurableStreamSink(
      identity,
      {
        operation,
        close: vi.fn(),
      } as unknown as NativeStreamPort,
      async () => {},
    );
    const begin = sink.begin({ kind: 'job', id: 'owned' }, 'x', 1);
    const outcome = expect(begin).rejects.toThrow('terminal');
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    const abort = sink.abort('cancelled');
    expect(operations.map((value) => value.operation)).toEqual(['begin']);
    release({ ...identity, claim_generation: 1, accepted_offset: 0, terminal: false });
    await Promise.all([outcome, abort]);
    expect(operations.map((value) => value.operation)).toEqual(['begin', 'abort']);
    await expect(sink.chunk(new Uint8Array([1]))).rejects.toThrow('terminal');
  });
  it('a filter cancellation cannot be followed by a late header admission or chunk', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const verify = async () => {
      if (first) {
        first = false;
        await gate;
      }
    };
    const operation = vi.fn(async (_operation: StreamOperation) => ({
      ...identity,
      claim_generation: 1,
      accepted_offset: 0,
      terminal: true,
    }));
    const close = vi.fn(),
      terminal = vi.fn();
    const sink = new DurableStreamSink(
      identity,
      { operation, close } as unknown as NativeStreamPort,
      verify,
      terminal,
    );
    const admission = sink.begin({ kind: 'job', id: 'owned' }, 'x', 1);
    await sink.abort('filter_interrupted');
    release();
    await expect(admission).rejects.toThrow('terminal');
    await expect(sink.chunk(Uint8Array.of(42))).rejects.toThrow('terminal');
    await expect(sink.end()).rejects.toThrow('terminal');
    await sink.abort('cancelled');
    expect(operation).toHaveBeenCalledOnce();
    expect(operation.mock.calls[0][0]).toMatchObject({ operation: 'abort' });
    expect(close).toHaveBeenCalledOnce();
    expect(terminal).toHaveBeenCalledOnce();
  });
  it('never reads another chunk before durable acknowledgement and bounds frames', async () => {
    const operations: StreamOperation[] = [];
    let offset = 0;
    let active = 0,
      peak = 0;
    let verifies = 0;
    const port = {
      operation: async (operation: StreamOperation) => {
        active++;
        peak = Math.max(peak, active);
        operations.push(operation);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (operation.operation === 'chunk') {
          expect(operation.offset).toBe(offset);
          expect(operation.data_base64.length).toBeLessThanOrEqual(262144);
          offset += atob(operation.data_base64).length;
        }
        active--;
        return {
          ...identity,
          accepted_offset: offset,
          claim_generation: 1,
          terminal: operation.operation === 'end',
        };
      },
      close: () => {},
    } as unknown as NativeStreamPort;
    const sink = new DurableStreamSink(identity, port, async () => {
      verifies++;
    });
    await sink.begin({ kind: 'job', id: 'owned' }, 'file.bin', STREAM_CHUNK_BYTES * 3 + 1);
    await sink.chunk(new Uint8Array(STREAM_CHUNK_BYTES * 3 + 1));
    await sink.end();
    expect(operations.map((x) => x.operation)).toEqual([
      'begin',
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'end',
    ]);
    expect(peak).toBe(1);
    expect(sink.peakBufferedBytes).toBe(STREAM_CHUNK_BYTES);
    expect(verifies).toBe(6);
  });
  it('rejects a forged acknowledgement or changed claim', async () => {
    const port = {
      operation: async () => ({
        ...identity,
        claim_generation: 2,
        accepted_offset: 0,
        terminal: false,
      }),
      close: () => {},
    } as unknown as NativeStreamPort;
    await expect(
      new DurableStreamSink(identity, port, async () => {}).begin(
        { kind: 'job', id: 'owned' },
        'x',
        1,
      ),
    ).rejects.toThrow('Stale');
  });
  it('reconnects only with an identical retained chunk after a lost durable ACK', async () => {
    let failed = false;
    const chunks: StreamOperation[] = [];
    const port = {
      operation: async (operation: StreamOperation) => {
        if (operation.operation === 'chunk') {
          chunks.push(operation);
          if (!failed) {
            failed = true;
            throw Error('Native stream disconnected');
          }
        }
        return {
          ...identity,
          claim_generation: 1,
          accepted_offset: operation.operation === 'chunk' ? 1 : 0,
          terminal: false,
        };
      },
      close: () => {},
    } as unknown as NativeStreamPort;
    const sink = new DurableStreamSink(identity, port, async () => {});
    await sink.begin({ kind: 'job', id: 'owned' }, 'x', 1);
    await sink.chunk(Uint8Array.of(42));
    expect(chunks[0]).toEqual(chunks[1]);
    expect(sink.offset).toBe(1);
  });
});

describe('original reader liveness heartbeat', () => {
  it('keeps one idle heartbeat in flight using original parameters without advancing offset, then stops on abort', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: any) => void;
      const operation = vi
        .fn()
        .mockResolvedValueOnce({
          stream_id: identity.stream_id,
          claim_generation: 1,
          source_generation: 1,
          accepted_offset: 0,
          terminal: false,
        })
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
      const sink = new DurableStreamSink(
        identity,
        { operation, close: vi.fn() } as unknown as NativeStreamPort,
        async () => {},
      );
      const target = { kind: 'job' as const, id: 'original' };
      await sink.begin(target, 'original.bin', null);
      target.id = 'mutated';
      await vi.advanceTimersByTimeAsync(30000);
      expect(operation).toHaveBeenCalledTimes(2);
      expect(operation.mock.calls[1][0]).toMatchObject({
        operation: 'begin',
        target: { kind: 'job', id: 'original' },
        filename: 'original.bin',
        total: null,
      });
      finish({
        stream_id: identity.stream_id,
        claim_generation: 1,
        source_generation: 1,
        accepted_offset: 123,
        terminal: false,
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(sink.offset).toBe(0);
      operation.mockResolvedValue({
        stream_id: identity.stream_id,
        claim_generation: 1,
        source_generation: 1,
        accepted_offset: 0,
        terminal: true,
      });
      await sink.abort();
      const calls = operation.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(operation).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retries transient native disconnect while idle, but stops renewing refused ownership', async () => {
    vi.useFakeTimers();
    try {
      const ack = {
        stream_id: identity.stream_id,
        claim_generation: 1,
        source_generation: 1,
        accepted_offset: 0,
        terminal: false,
      };
      const operation = vi
        .fn()
        .mockResolvedValueOnce(ack)
        .mockRejectedValueOnce(Error('Native stream disconnected'))
        .mockResolvedValueOnce(ack)
        .mockRejectedValueOnce(Error('Stale or foreign browser stream ownership'));
      const sink = new DurableStreamSink(
        identity,
        { operation, close: vi.fn() } as unknown as NativeStreamPort,
        async () => {},
      );
      await sink.begin({ kind: 'job', id: 'original' }, 'original.bin', 10);
      await vi.advanceTimersByTimeAsync(30000);
      expect(operation).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(60000);
      expect(operation).toHaveBeenCalledTimes(4);
      operation.mockResolvedValue({ ...ack, terminal: true });
      await sink.abort();
    } finally {
      vi.useRealTimers();
    }
  });
  it('clears liveness renewal after verified EOF', async () => {
    vi.useFakeTimers();
    try {
      const operation = vi.fn(async (value: StreamOperation) => ({
        stream_id: identity.stream_id,
        claim_generation: 1,
        source_generation: 1,
        accepted_offset: 0,
        terminal: value.operation === 'end',
      }));
      const sink = new DurableStreamSink(
        identity,
        { operation, close: vi.fn() } as unknown as NativeStreamPort,
        async () => {},
      );
      await sink.begin({ kind: 'job', id: 'original' }, 'original.bin', null);
      await sink.end();
      await vi.advanceTimersByTimeAsync(60000);
      expect(operation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
