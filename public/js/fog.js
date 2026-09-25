// Full-screen fog: three noise layers sliding at different speeds, quantized to a dithered gray
// ramp. When the spirit is present it churns and shifts to green.
import { FOG, GHOST_FOG } from "./palettes.js";
import { bayer, clamp01, periodicNoise } from "./pixel.js";

/** Each layer is a TILE × TILE tile that wraps on both axes, so it covers any window. */
const TILE = 512;
/** Cap on fog pixels per frame: on huge screens, chunkier pixels are used. */
const MAX_PIXELS = 700_000;
/** The fog moves less than a pixel per frame: repainting it 24 times per second is enough. */
const DRAW_INTERVAL_MS = 1000 / 24;
/** The layers: the seed and the scale of each one's noise. */
const LAYERS = [
  [3, 1],
  [41, 1.7],
  [77, 0.6],
];
/** Threshold and contrast that turn the noise into wisps (higher threshold = more gaps). */
const DENSITY_THRESHOLD = 0.34;
const DENSITY_CONTRAST = 2.3;

/** @param {number} seed @param {number} scale */
function renderLayer(seed, scale) {
  const layer = new Float32Array(TILE * TILE);
  // Cells per tile for each octave: wide, flattened wisps
  const octaves = [
    [6, 10, 0.55],
    [14, 26, 0.3],
    [36, 56, 0.15],
  ].map(([cx, cy, weight]) => [Math.round(cx * scale), Math.round(cy * scale), weight]);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = 0;
      octaves.forEach(([cx, cy, weight], n) => {
        v += periodicNoise((x / TILE) * cx, (y / TILE) * cy, cx, cy, seed + n * 101) * weight;
      });
      layer[y * TILE + x] = v;
    }
  }
  return layer;
}

function sample(layer, x, y) {
  const x0 = Math.floor(x);
  const row = (y & (TILE - 1)) * TILE;
  const a = layer[row + (x0 & (TILE - 1))];
  return a + (layer[row + ((x0 + 1) & (TILE - 1))] - a) * (x - x0);
}

/** Palette packed as ABGR (the byte order of ImageData on little-endian machines). */
function packedPalette(presence) {
  const mix = presence * 0.8;
  return FOG.map(([r, g, b], n) => {
    const [gr, gg, gb] = GHOST_FOG[n];
    const channel = (from, to) => Math.round(from + (to - from) * mix);
    return ((255 << 24) | (channel(b, gb) << 16) | (channel(g, gg) << 8) | channel(r, gr)) >>> 0;
  });
}

export class Fog {
  #canvas;
  #ctx;
  #motion;
  #layers = null;
  #image = null;
  #pixels = null;
  /** CSS pixels per fog pixel. */
  #size = 0;
  #clock = 0;
  #lastDraw = -Infinity;
  #lastPresence = -1;
  #dirty = true;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ motion?: { reduced: boolean } }} [options] with reduced motion, the fog doesn't drift
   */
  constructor(canvas, { motion = { reduced: false } } = {}) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    this.#motion = motion;
  }

  /**
   * Generates the noise layers, a few hundred milliseconds in all: one per task, so the page stays responsive
   * meanwhile (someone may be typing already). Called after the first frame so as not to delay the board's
   * appearance; until then the page's plain background shows through.
   */
  async prepare() {
    const layers = [];
    for (const [seed, scale] of LAYERS) {
      await new Promise((resolve) => setTimeout(resolve));
      layers.push(renderLayer(seed, scale));
    }
    this.#layers = layers;
    this.#dirty = true;
  }

  /**
   * Fits the canvas to the window with pixels the same size as the board's.
   *
   * @param {number} cssPixel CSS size of one board pixel
   */
  resize(cssPixel) {
    let size = cssPixel;
    while ((window.innerWidth / size) * (window.innerHeight / size) > MAX_PIXELS) size *= 2;
    const canvas = this.#canvas;
    const width = Math.ceil(window.innerWidth / size);
    const height = Math.ceil(window.innerHeight / size);
    // A layout that changes nothing here (a language switch, say) keeps the fog as it is
    if (this.#image && canvas.width === width && canvas.height === height && this.#size === size) return;
    this.#size = size;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${canvas.width * size}px`;
    canvas.style.height = `${canvas.height * size}px`;
    this.#image = this.#ctx.createImageData(canvas.width, canvas.height);
    this.#pixels = new Uint32Array(this.#image.data.buffer);
    this.#dirty = true;
  }

  /**
   * @param {number} dt milliseconds since the last frame
   * @param {number} presence 0 = calm, 1 = the spirit is present (churns faster)
   */
  update(dt, presence) {
    if (!this.#motion.reduced) this.#clock += (dt / 1000) * (1 + presence * 2.5);
  }

  /**
   * Repaints when due: at most once every DRAW_INTERVAL_MS, and only if something has changed.
   *
   * @param {number} now timestamp in milliseconds
   * @param {number} presence
   */
  draw(now, presence) {
    if (!this.#image || !this.#layers) return;
    const changed = this.#dirty || Math.abs(presence - this.#lastPresence) > 0.01 || !this.#motion.reduced;
    if (!changed || (!this.#dirty && now - this.#lastDraw < DRAW_INTERVAL_MS)) return;
    this.#dirty = false;
    this.#lastDraw = now;
    this.#lastPresence = presence;

    const palette = packedPalette(presence);
    const last = palette.length - 1;
    const [a, b, c] = this.#layers;
    const t = this.#clock;
    // Each layer slides at its own pace; the first two also drift slowly vertically
    const ax = t * 9;
    const bx = -t * 5;
    const cx = t * 2.5;
    const ay = Math.floor(t * 1.5);
    const by = Math.floor(-t * 2.2);
    const { width, height } = this.#canvas;
    const pixels = this.#pixels;
    for (let y = 0; y < height; y++) {
      const lift = (y / height - 0.5) * 0.2; // slightly denser at the bottom
      for (let x = 0; x < width; x++) {
        const v = sample(a, x + ax, y + ay) * 0.5 + sample(b, x + bx, y + by) * 0.3 + sample(c, x + cx, y) * 0.2;
        const density = clamp01((v - DENSITY_THRESHOLD) * DENSITY_CONTRAST + lift);
        pixels[y * width + x] = palette[Math.floor(density * last + bayer(x, y))];
      }
    }
    this.#ctx.putImageData(this.#image, 0, 0);
  }
}
