import { STREAM_CHUNK_BYTES } from '../../../../../packages/shared/src/navigation';
// Runs in the owning document's isolated extension world. No window message bridge.
export async function readOwnedBlob(
  url: string,
  capability: string,
  chunkBytes = STREAM_CHUNK_BYTES,
): Promise<void> {
  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  if (!runtime) throw Error('Page stream extension world is unavailable');
  const send = (message: any) =>
    runtime.sendMessage({ type: 'owned_blob_stream', capability, ...message });
  if (new URL(url).protocol !== 'blob:' || new URL(url).origin !== location.origin)
    throw Error('Blob is outside its owning document');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body || response.type === 'opaque')
      throw Error('Blob is unavailable or unreadable');
    reader = response.body.getReader();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      for (let index = 0; index < part.value.length; index += chunkBytes) {
        let text = '';
        for (const byte of part.value.subarray(index, index + chunkBytes))
          text += String.fromCharCode(byte);
        const ack = await send({ operation: 'chunk', data_base64: btoa(text) });
        if (ack !== true) throw Error('Page stream ownership changed');
      }
    }
    await send({ operation: 'end' });
  } catch (error) {
    await reader?.cancel().catch(() => {});
    await send({ operation: 'abort' }).catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
