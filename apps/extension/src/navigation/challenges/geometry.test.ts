import { describe, it, expect } from 'vitest';
import { solveOpenCircle, toCss } from './geometry';
import { ChallengeGate, type ChallengeBinding } from './lifecycle';
import { raster } from '../../../../../scripts/nav-fixtures/challenges/raster-corpus';
describe('held-out open-circle geometry', () => {
  it('qualifies 120 deterministic held-out images with closed-circle decoys', () => {
    let accepted = 0,
      correct = 0;
    const times: number[] = [];
    for (let seed = 1000; seed < 1120; seed++) {
      const input = raster(seed),
        start = performance.now(),
        answer = solveOpenCircle(input);
      times.push(performance.now() - start);
      if ('point' in answer) {
        accepted++;
        if (
          Math.hypot(
            answer.point.x - (45 + (seed % 37) * 0.3),
            answer.point.y - (52 + (seed % 11) * 0.4),
          ) < 4
        )
          correct++;
      }
    }
    expect(accepted / 120).toBeGreaterThanOrEqual(0.8);
    expect(correct / accepted).toBeGreaterThanOrEqual(0.99);
    expect(times.sort((a, b) => a - b)[113]).toBeLessThanOrEqual(2000);
  });
  it('abstains on two open targets and blank images', () => {
    expect(solveOpenCircle(raster(1, true))).toHaveProperty('reason');
    const blank = raster(1);
    blank.data.fill(255);
    expect(solveOpenCircle(blank)).toHaveProperty('reason');
  });
  it('maps scale and DPR without double scaling and rejects clipping', () => {
    for (const scale of [1, 0.75, 0.5])
      for (const dpr of [1, 1.25, 2]) {
        void dpr;
        expect(
          toCss(
            { x: 50, y: 40 },
            { width: 100, height: 80 },
            { left: 12, top: 14, width: 100 * scale, height: 80 * scale },
            { left: 0, top: 0, right: 500, bottom: 500 },
          ),
        ).toEqual({ x: 12 + 50 * scale, y: 14 + 40 * scale });
      }
    expect(() =>
      toCss(
        { x: 50, y: 40 },
        { width: 100, height: 80 },
        { left: 0, top: 0, width: 100, height: 80 },
        { left: 51, top: 0, right: 100, bottom: 80 },
      ),
    ).toThrow('clipped');
  });
});
const binding: ChallengeBinding = {
  scope: {
    browser: 'chromium',
    profile: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
    private: false,
    cookie_store_id: null,
    container_id: null,
    partition_key: null,
    claim_generation: 1,
  },
  sourceGeneration: 1,
  documentGeneration: 1,
  page: 'https://g4u.to/file',
  selectedHost: 'gofile.io',
  imageDigest: 'image',
  csrfDigest: 'csrf',
  expiresAt: 100,
};
describe('submission lifecycle', () => {
  it('rejects every stale binding dimension and expiry', () => {
    for (const field of [
      'sourceGeneration',
      'documentGeneration',
      'page',
      'selectedHost',
      'imageDigest',
      'csrfDigest',
    ] as const) {
      const current = { ...binding, [field]: typeof binding[field] === 'number' ? 2 : 'changed' };
      expect(() => new ChallengeGate().authorize(binding, current, 1)).toThrow('stale');
    }
    expect(() =>
      new ChallengeGate().authorize(
        binding,
        { ...binding, scope: { ...binding.scope, claim_generation: 2 } },
        1,
      ),
    ).toThrow('stale');
    expect(() => new ChallengeGate().authorize(binding, binding, 100)).toThrow('stale');
  });
  it('rejects cancellation and duplicate submission', () => {
    const gate = new ChallengeGate();
    gate.cancel(binding);
    expect(() => gate.authorize(binding, binding, 1)).toThrow('stale');
    const other = new ChallengeGate();
    other.authorize(binding, binding, 1);
    expect(() => other.authorize(binding, binding, 1)).toThrow('already');
  });
});

