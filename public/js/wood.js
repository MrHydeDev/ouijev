import { valueNoise } from "./pixel.js";

/** The grain is computed in a space larger than the board so that it comes out fine. */
export const GRAIN = 1.6;

/**
 * Light level of the wood (0-1) at a point: the grain is continuous lines that part around the knots,
 * with growth bands, fine fiber and pores.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, r: number }[]} [knots]
 */
export function woodValue(x, y, knots = []) {
  let u = y;
  let knotValue = -1;
  for (const knot of knots) {
    const dx = (x - knot.x) / 2.4;
    const dy = y - knot.y;
    const d = Math.hypot(dx, dy);
    u += knot.r * 1.7 * Math.exp(-(d * d) / (2 * (knot.r * 2.6) ** 2)) * Math.tanh(dy / (knot.r * 0.8));
    if (d < knot.r) knotValue = 0.34 - (1 - d / knot.r) * 0.22 + Math.sin(d * 1.7) * 0.07;
  }
  if (knotValue >= 0) return knotValue;
  const warp = valueNoise(x * 0.005, u * 0.02) * 14 + valueNoise(x * 0.02, u * 0.07) * 3;
  const bands = Math.sin(u * 0.2 + warp);
  const lines = (0.5 + 0.5 * Math.sin(u * 0.95 + warp * 3 + valueNoise(x * 0.01, u * 0.3) * 4)) ** 3;
  return 0.64 + bands * 0.1 - lines * 0.16 + (valueNoise(x * 0.035, u * 1.1) - 0.5) * 0.24;
}
