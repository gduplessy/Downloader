import { describe, expect, it } from 'vitest';
import { handleDestinationSetup } from './destination-setup';
const event = {
  type: 'desktop_destination_setup',
  sequence: 10,
  nonce: 'f0f0f0f0-1234-4321-9876-f0f0f0f0f0f0',
  expires_at: 1100,
};
describe('destination setup events', () => {
  it('ignores stale, cursor-replayed, invalid, and future events', async () => {
    let consumed = 0;
    await handleDestinationSetup(
      [
        { ...event, expires_at: 1 },
        { ...event, sequence: 9 },
        { ...event, nonce: 'bad' },
        { ...event, expires_at: 20000 },
      ],
      9,
      1000,
      async () => {
        consumed++;
        return true;
      },
      async () => {
        throw Error('must not open');
      },
    );
    expect(consumed).toBe(0);
  });
  it('opens only after an authoritative one-use consume receipt', async () => {
    let opened = 0,
      consumed = false;
    await handleDestinationSetup(
      [event, event],
      9,
      1000,
      async () => {
        const accepted = !consumed;
        consumed = true;
        return accepted;
      },
      async () => {
        opened++;
      },
    );
    expect(opened).toBe(1);
  });
});
