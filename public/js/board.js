// The board: grained wood with knots and scratches, plus all the engraving (frame, letters, sun, moon, pentagrams).
import { drawString, FONTS, textWidth } from "./font.js";
import { at, AXIS, BOARD, boardDepth, HEIGHT, SPOTS, TITLE, WIDTH, WORD_SPOTS } from "./layout.js";
import { CRACK, INK, WOOD } from "./palettes.js";
import { clamp01, makeCanvas, pentagram, rng, shade, sparkle, valueNoise } from "./pixel.js";
import { GRAIN, woodValue } from "./wood.js";

/** Wood knots, placed in gaps without letters (in grain coordinates). */
const KNOTS = [
  { x: 552, y: 246, r: 9 },
  { x: 96, y: 300, r: 6 },
];

/** Double frame with concave corners. */
function engraveFrame(g) {
  const x0 = BOARD.x + 8;
  const y0 = BOARD.y + 8;
  const x1 = BOARD.x + BOARD.width - 9;
  const y1 = BOARD.y + BOARD.height - 9;
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dc = Math.min(...corners.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));
      const edge = Math.min(x - x0, x1 - x, y - y0, y1 - y);
      const outer = (edge < 2 && dc > 12) || (Math.abs(dc - 12) <= 1 && edge >= 0);
      const inner = (edge === 4 && dc > 16) || (Math.abs(dc - 16) <= 0.5 && edge >= 4);
      if (outer || inner || dc <= 2) g.fillRect(x, y, 1, 1);
    }
  }
}

function engraveSun(g, { x: cx, y: cy }) {
  const step = Math.PI / 4;
  for (let y = -14; y <= 14; y++) {
    for (let x = -14; x <= 14; x++) {
      const r = Math.hypot(x, y);
      const k = Math.round(Math.atan2(y, x) / step);
      const length = k % 2 === 0 ? 13 : 10;
      const spread = Math.abs(Math.atan2(y, x) - k * step) * r;
      const ray = r >= 7.5 && r <= length && spread < 2.2 * (1 - (r - 7.5) / (length - 7));
      if (r <= 5.5 || ray) g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}

function engraveMoon(g, { x: cx, y: cy }) {
  for (let y = -10; y <= 10; y++) {
    for (let x = -10; x <= 10; x++) {
      if (Math.hypot(x, y) <= 9.5 && Math.hypot(x - 4, y + 2) > 8) g.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  sparkle(g, cx + 6, cy - 4, 1);
}

/**
 * Flourishes on either side of a word. They start a fixed gap past its ends, measured in the font the board
 * is drawn with: the system serif can be wider than Palatino.
 */
function engraveFlourishes(g, { text, x: cx, y, font, spacing }) {
  const start = Math.ceil(textWidth(text, font, spacing) / 2) + 13;
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 38; i++) g.fillRect(cx + dir * (start + i), y, 1, 1);
    const diamond = cx + dir * (start + 19);
    for (let r = 0; r <= 3; r++) g.fillRect(diamond - (3 - r), y - r, (3 - r) * 2 + 1, r * 2 + 1);
    sparkle(g, cx + dir * (start + 46), y, 1);
  }
}

const STARS = [
  [124, 20, 2],
  [116, 32, 1],
  [272, 20, 2],
  [280, 32, 1],
  [64, 204, 1],
  [332, 204, 1],
  [58, 176, 1],
  [338, 176, 1],
];

/** Everything "burned" into the wood is drawn on a mask that is then engraved with relief. */
function renderInkMask() {
  const g = makeCanvas(WIDTH, HEIGHT).getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000";
  engraveFrame(g);
  engraveSun(g, at(36, 24));
  engraveMoon(g, at(360, 24));
  for (const [x, y, arm] of STARS) {
    const star = at(x, y);
    sparkle(g, star.x, star.y, arm);
  }
  for (const corner of [at(34, 194), at(362, 194)]) pentagram(g, corner.x, corner.y, 10);
  engraveFlourishes(g, WORD_SPOTS.GOODBYE);

  const title = at(AXIS, 24);
  drawString(g, TITLE, title.x, title.y, FONTS.title, "#000", 3);
  for (const spot of [...Object.values(SPOTS), ...Object.values(WORD_SPOTS)]) {
    drawString(g, spot.text, spot.x, spot.y, spot.font, "#000", spot.spacing);
  }
  return g.getImageData(0, 0, WIDTH, HEIGHT).data;
}

/** Scratches (a light line with its shadow below) and a couple of cracks along the edge. */
function renderWear(rand) {
  const marks = new Float32Array(WIDTH * HEIGHT);
  const cracks = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < 14; i++) {
    const x = BOARD.x + 16 + rand() * (BOARD.width - 32);
    const y = BOARD.y + 16 + rand() * (BOARD.height - 32);
    const angle = (rand() - 0.5) * 1.6 + (rand() < 0.5 ? 0 : Math.PI / 2);
    const length = 8 + rand() * 50;
    for (let s = 0; s < length; s++) {
      const px = Math.round(x + Math.cos(angle) * s);
      const py = Math.round(y + Math.sin(angle) * s);
      if (boardDepth(px, py) < 6) continue;
      marks[py * WIDTH + px] = 0.12;
      marks[(py + 1) * WIDTH + px] = -0.1;
    }
  }
  const crackPaths = [
    [BOARD.x + 2, BOARD.y + 150, 1, -0.25, 70],
    [BOARD.x + 318, BOARD.y + BOARD.height - 3, -0.2, -1, 40],
  ];
  for (const [sx, sy, dx, dy, length] of crackPaths) {
    let x = sx;
    let y = sy;
    for (let s = 0; s < length; s++) {
      x += dx + (rand() - 0.5) * 1.4;
      y += dy + (rand() - 0.5) * 1.4;
      cracks[Math.round(y) * WIDTH + Math.round(x)] = 1;
    }
  }
  return { marks, cracks };
}

/** Paints the board on a scene-sized canvas, transparent outside the board. */
export function renderBoard() {
  const canvas = makeCanvas(WIDTH, HEIGHT);
  const g = canvas.getContext("2d");
  const ink = renderInkMask();
  const { marks, cracks } = renderWear(rng(7));
  const image = g.createImageData(WIDTH, HEIGHT);
  const put = (i, [r, gr, b]) => {
    image.data[i] = r;
    image.data[i + 1] = gr;
    image.data[i + 2] = b;
    image.data[i + 3] = 255;
  };

  for (let y = BOARD.y; y < BOARD.y + BOARD.height; y++) {
    for (let x = BOARD.x; x < BOARD.x + BOARD.width; x++) {
      const depth = boardDepth(x, y);
      if (depth < 0) continue;
      const p = y * WIDTH + x;
      const i = p * 4;
      const lx = x - BOARD.x;
      const ly = y - BOARD.y;

      let v = woodValue(lx * GRAIN, ly * GRAIN, KNOTS);
      v += 0.08 * Math.exp(-(((lx - ly * 0.7 - 130) / 75) ** 2)); // varnish sheen
      v -= Math.max(0, valueNoise(lx * 0.02 + 7.3, ly * 0.026 + 2.1) - 0.62) * 0.7; // damp stains
      const burn = clamp01((16 - depth) / 16);
      v -= burn * burn * (0.14 + 0.3 * valueNoise(lx * 0.07, ly * 0.07 + 33)); // scorched edges
      v += marks[p];
      if (depth < 1.5) v = 0.1;
      else if (depth < 4) v += lx + ly < (BOARD.width + BOARD.height) / 2 ? 0.2 : -0.24; // bevel

      // The engraving has relief: the pixel below and to the right of each stroke catches the light
      const litNeighbor = ((y - 1) * WIDTH + (x - 1)) * 4;
      if (ink[i + 3] > 0) put(i, INK);
      else if (cracks[p]) put(i, CRACK);
      else if (ink[litNeighbor + 3] > 0 || cracks[p - 1]) {
        put(i, WOOD[Math.min(WOOD.length - 1, shade(WOOD, v, x, y) + 2)]);
      } else put(i, WOOD[shade(WOOD, v, x, y)]);
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}
