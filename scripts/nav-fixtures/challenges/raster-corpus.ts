import type { Raster } from '../../../apps/extension/src/navigation/challenges/geometry';
export function raster(seed: number, ambiguous = false): Raster {
  const width = 240,
    height = 120,
    data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  function ring(cx: number, cy: number, r: number, gap: boolean) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const angle = Math.atan2(y - cy, x - cx),
          distance = Math.hypot(x - cx, y - cy);
        if (Math.abs(distance - r) < 2.1 && (!gap || angle < 0.2 || angle > 0.9)) {
          const i = (y * width + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 35;
        }
      }
  }
  ring(45 + (seed % 37) * 0.3, 52 + (seed % 11) * 0.4, 20 + (seed % 19) * 0.17, true);
  ring(150, 58, 22, ambiguous);
  return { width, height, data };
}
