// The planchette: varnished walnut, a glazed brass viewing window and an inlaid TypeSafe AI logo.
import { BRASS, WALNUT } from "./palettes.js";
import { css, makeCanvas, thinLine, tone } from "./pixel.js";
import { woodValue } from "./wood.js";

/** The sprite origin is the center of the viewing window: that is where it "points". */
export const PLANCHETTE_ORIGIN = Object.freeze({ x: 23, y: 34 });
const SPRITE_HEIGHT = 71;

// TypeSafe AI logo (geometric part only). At this size the official SVG's strokes clump together,
// so its skeleton is drawn instead: the center line of each stroke, which falls on a 5-column
// isometric grid (3 px per column, 2 px per diagonal step). It takes up 13 × 19 px.
const LOGO_WIDTH = 13;
// prettier-ignore
const LOGO_LINES = [
  // Outline
  [6, 0, 0, 4], [6, 0, 9, 2], [9, 2, 9, 5], [9, 5, 12, 7], [12, 7, 12, 14],
  [12, 14, 6, 18], [6, 18, 3, 16], [3, 16, 3, 13], [3, 13, 0, 11], [0, 11, 0, 4],
  // Small top cube
  [6, 0, 6, 3], [3, 5, 6, 3], [6, 3, 9, 5], [9, 5, 6, 7], [6, 7, 3, 5], [3, 5, 3, 9], [6, 7, 6, 11],
  // Left rhombus
  [0, 11, 3, 9], [3, 9, 6, 11], [6, 11, 3, 13],
  // Bottom-right cube
  [9, 5, 9, 12], [3, 16, 9, 12], [9, 12, 12, 14],
];

function drawLogo(g, left, top) {
  for (const [x0, y0, x1, y1] of LOGO_LINES) thinLine(g, left + x0, top + y0, left + x1, top + y1);
}

/** Teardrop shape, elongated below the viewing window so the logo fits. */
function insideBody(x, y) {
  if (x * x + (y - 13) * (y - 13) <= 23 * 23) return true;
  return y >= -34 && y <= 13 && Math.abs(x) <= 23 * Math.sin((Math.PI / 2) * ((y + 34) / 47)) ** 0.85;
}

function edgeDistance(x, y) {
  for (let d = 1; d <= 2; d++) {
    if (!insideBody(x - d, y) || !insideBody(x + d, y) || !insideBody(x, y - d) || !insideBody(x, y + d)) return d;
  }
  return 3;
}

export function renderPlanchette() {
  const { x: ox, y: oy } = PLANCHETTE_ORIGIN;
  const canvas = makeCanvas(ox * 2 + 1, SPRITE_HEIGHT);
  const g = canvas.getContext("2d");

  for (let y = -oy; y < SPRITE_HEIGHT - oy; y++) {
    for (let x = -ox; x <= ox; x++) {
      if (!insideBody(x, y)) continue;
      const r = Math.hypot(x, y);
      const px = x + ox;
      const py = y + oy;
      const light = -(x + y) / Math.max(1, r) / Math.SQRT2; // light from the upper left
      if (r < 9) {
        // Glass: a bluish tint and a glint
        const glint = r > 5.5 && r < 8 && light > 0.8;
        g.fillStyle = glint ? "rgba(255, 255, 255, 0.8)" : "rgba(190, 225, 255, 0.12)";
      } else if (r < 12.5) {
        // Brass ring
        g.fillStyle = r >= 11.5 || r < 9.8 ? css(BRASS[0]) : tone(BRASS, 0.55 + light * 0.45, px, py);
      } else {
        const edge = edgeDistance(x, y);
        let v = 0.5 - (x + y) / 140 + (woodValue(x * 3 + 300, y * 1.4 + 700) - 0.64) * 0.9;
        v += 0.25 * Math.exp(-(((x + y + 22) / 5) ** 2)); // varnish sheen
        if (edge === 1) v = 0;
        else if (edge === 2) v += x + y < 0 ? 0.3 : -0.25;
        g.fillStyle = tone(WALNUT, v, px, py);
      }
      g.fillRect(px, py, 1, 1);
    }
  }

  g.fillStyle = css(BRASS[3]);
  drawLogo(g, ox - (LOGO_WIDTH - 1) / 2, oy + 14);
  return canvas;
}
