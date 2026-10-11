import { solveOpenCircle } from '../../../apps/extension/src/navigation/challenges/geometry';
import { raster } from './raster-corpus';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const times: number[] = [],
  hashes = new Set<string>();
let accepted = 0,
  correct = 0,
  negativeAccepted = 0;
for (let seed = 1000; seed < 1120; seed++) {
  const image = raster(seed);
  hashes.add(createHash('sha256').update(image.data).digest('hex'));
  const start = performance.now(),
    answer = solveOpenCircle(image);
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
for (let seed = 2000; seed < 2080; seed++) {
  const image = raster(seed, true);
  if (seed % 2) image.data.fill(255);
  if ('point' in solveOpenCircle(image)) negativeAccepted++;
}
times.sort((a, b) => a - b);
assert.equal(hashes.size, 120);
assert(accepted / 120 >= 0.8);
assert(correct / accepted >= 0.99);
assert(times[113] <= 2000);
assert.equal(negativeAccepted, 0);
const report = {
  fixture: 'unique-open-circle-heldout-v2',
  development_seeds: '0..19',
  heldout_seeds: '1000..1119',
  heldout_images: 120,
  unique_pixel_hashes: hashes.size,
  accepted,
  correct,
  abstained: 120 - accepted,
  accepted_accuracy: correct / accepted,
  non_abstention: accepted / 120,
  negative_images: 80,
  negative_accepted: negativeAccepted,
  latency_ms: { p50: times[59], p95: times[113] },
  machine: {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    node: process.version,
  },
  coverage:
    'Open dark circle, closed-circle decoy, variable subpixel centers/radii; separate scale/DPR/clipping and stale lifecycle tests. Unknown live variants and real-image occlusion remain unqualified.',
};
writeFileSync('.local/nav-challenges/corpus-result.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

