// Pixel art utilities: dithered palettes, procedural noise and pure-pixel shapes.

/** @param {number} w @param {number} h */
export function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** @param {string} hex `#rrggbb` */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * Ramp of `n` tones interpolated between a few key colors. Few tones = visible dithering,
 * which is what gives the pixel art look.
 *
 * @param {string[]} stops
 * @param {number} n
 * @returns {number[][]} `[r, g, b]` colors
 */
export function ramp(stops, n) {
  const keys = stops.map(hexToRgb);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (keys.length - 1);
    const k = Math.min(keys.length - 2, Math.floor(t));
    return keys[k].map((v, c) => Math.round(v + (keys[k + 1][c] - v) * (t - k)));
  });
}

export const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 4x4 Bayer matrix: the dithering threshold for each pixel
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

/** Index of the `palette` tone for a light level `v` (0-1) at pixel (x, y), with ordered dithering. */
export const shade = (palette, v, x, y) => Math.floor(clamp01(v) * (palette.length - 1) + bayer(x, y));
/** Same as `shade`, but returns the CSS color. */
export const tone = (palette, v, x, y) => css(palette[shade(palette, v, x, y)]);

/** Integer hash → [0, 1]: the basis of all the noise, deterministic so the board always comes out the same. */
function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** A lattice cell's four corner values, blended at (sx, sy): the heart of value noise. */
const blend = (a, b, c, d, sx, sy) => a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;

/** Value noise with smooth interpolation. */
export function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const sx = smooth(x - xi);
  const sy = smooth(y - yi);
  return blend(hash(xi, yi), hash(xi + 1, yi), hash(xi, yi + 1), hash(xi + 1, yi + 1), sx, sy);
}

/** Periodic value noise: the lattice repeats every `cx` × `cy` cells, so the tile wraps seamlessly. */
export function periodicNoise(x, y, cx, cy, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const sx = smooth(x - xi);
  const sy = smooth(y - yi);
  const x0 = xi % cx;
  const y0 = yi % cy;
  const x1 = (x0 + 1) % cx;
  const y1 = (y0 + 1) % cy;
  return blend(hash(x0 + seed, y0), hash(x1 + seed, y0), hash(x0 + seed, y1), hash(x1 + seed, y1), sx, sy);
}

/** Seeded pseudorandom generator (mulberry32). */
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Signed distance to the edge of a rounded rectangle (negative inside). */
export function roundRectSdf(x, y, x0, y0, x1, y1, r) {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// --- Pure-pixel shapes, drawn with the context's current `fillStyle` ---

/** Cross-shaped sparkle. */
export function sparkle(g, x, y, arm) {
  g.fillRect(x - arm, y, arm * 2 + 1, 1);
  g.fillRect(x, y - arm, 1, arm * 2 + 1);
}

/** Thick line (2 px per diagonal step): for engravings, where visual weight is wanted. */
function line(g, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= n; i++) {
    g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
  }
}

/** Thin line (1 px per step along the major axis): diagonals don't get thicker. */
export function thinLine(g, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
  }
}

function ring(g, cx, cy, r) {
  for (let a = 0; a < Math.PI * 2; a += 0.5 / r) {
    g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}

/** Inverted pentagram (one point down) inside a double circle. */
export function pentagram(g, cx, cy, r) {
  ring(g, cx, cy, r);
  ring(g, cx, cy, r + 3);
  const points = [0, 1, 2, 3, 4].map((i) => {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
  for (let i = 0; i < 5; i++) line(g, ...points[i], ...points[(i + 2) % 5]);
}

/** Dithered halo (no smooth gradients: it's pixel art). */
export function renderHalo(radius, color, power) {
  const size = radius * 2 + 1;
  const canvas = makeCanvas(size, size);
  const g = canvas.getContext("2d");
  g.fillStyle = color;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const falloff = 1 - Math.hypot(x - radius, y - radius) / radius;
      if (falloff > 0 && falloff ** power > bayer(x, y)) g.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}
