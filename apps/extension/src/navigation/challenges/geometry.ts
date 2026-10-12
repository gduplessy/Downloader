/** Qualified dark open-circle images only. Pixels remain inside the owning page. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export type Point = { x: number; y: number };
export type Solution = { point: Point; confidence: number } | { reason: string };
export function solveOpenCircle(image: Raster): Solution {
  const { width: w, height: h, data } = image;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 32 ||
    h < 32 ||
    w > 1000 ||
    h > 1000 ||
    data.length !== w * h * 4
  )
    return { reason: 'unsupported_image' };
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++)
    dark[i] =
      data[i * 4 + 3] > 200 && Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 110
        ? 1
        : 0;
  const seen = new Uint8Array(w * h),
    candidates: Solution[] = [];
  for (let seed = 0; seed < dark.length; seed++) {
    if (!dark[seed] || seen[seed]) continue;
    const queue = [seed],
      pixels: number[] = [];
    seen[seed] = 1;
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    for (let at = 0; at < queue.length; at++) {
      const i = queue[at],
        x = i % w,
        y = Math.floor(i / w);
      pixels.push(i);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const nx = x + dx,
          ny = y + dy,
          j = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && dark[j] && !seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    const bw = maxX - minX + 1,
      bh = maxY - minY + 1,
      r = (bw + bh) / 4,
      cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    if (
      bw < 16 ||
      bh < 16 ||
      bw / bh < 0.8 ||
      bw / bh > 1.25 ||
      minX < 4 ||
      minY < 4 ||
      maxX > w - 5 ||
      maxY > h - 5 ||
      pixels.length < 25
    )
      continue;
    const bins = new Uint8Array(72);
    let radial = 0;
    for (const i of pixels) {
      const dx = (i % w) - cx,
        dy = Math.floor(i / w) - cy,
        d = Math.hypot(dx, dy);
      if (d > r * 0.72 && d < r * 1.15) {
        radial++;
        bins[Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 72) % 72] = 1;
      }
    }
    if (radial / pixels.length < 0.95) continue;
    let missing = 0,
      longest = 0,
      run = 0;
    for (let i = 0; i < 144; i++) {
      if (!bins[i % 72]) {
        run++;
        longest = Math.max(longest, run);
        if (i < 72) missing++;
      } else run = 0;
    }
    // Closed circles, broken clutter, and excessively open arcs abstain.
    if (missing < 5 || missing > 18 || longest < 5 || longest > 18 || missing - longest > 2)
      continue;
    if (dark[Math.round(cy) * w + Math.round(cx)]) continue;
    candidates.push({ point: { x: cx, y: cy }, confidence: radial / pixels.length });
  }
  return candidates.length === 1
    ? candidates[0]
    : { reason: candidates.length ? 'ambiguous_image' : 'unsupported_image' };
}
export function toCss(
  point: Point,
  intrinsic: { width: number; height: number },
  rect: { left: number; top: number; width: number; height: number },
  clip: { left: number; top: number; right: number; bottom: number },
): Point {
  if (intrinsic.width <= 0 || intrinsic.height <= 0 || rect.width <= 0 || rect.height <= 0)
    throw Error('invalid_geometry');
  const p = {
    x: rect.left + (point.x / intrinsic.width) * rect.width,
    y: rect.top + (point.y / intrinsic.height) * rect.height,
  };
  // CSS coordinates deliberately do not multiply by devicePixelRatio.
  if (
    !Number.isFinite(p.x) ||
    !Number.isFinite(p.y) ||
    p.x < clip.left + 2 ||
    p.y < clip.top + 2 ||
    p.x > clip.right - 2 ||
    p.y > clip.bottom - 2
  )
    throw Error('clipped_target');
  return p;
}
