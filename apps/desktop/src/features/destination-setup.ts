export type SetupEvent = { type: string; nonce?: string; expires_at?: number; sequence: number };
/** Consume before focusing: the engine atomically fences repeats across windows and restarts. */
export async function handleDestinationSetup(
  events: SetupEvent[],
  cursor: number,
  now: number,
  consume: (nonce: string) => Promise<boolean>,
  open: () => Promise<void>,
) {
  for (const event of events) {
    if (
      event.type !== 'desktop_destination_setup' ||
      event.sequence <= cursor ||
      typeof event.nonce !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.nonce) ||
      !Number.isSafeInteger(event.expires_at) ||
      event.expires_at! <= now ||
      event.expires_at! > now + 15_000
    )
      continue;
    if (await consume(event.nonce)) await open();
  }
}
