// Pure-pixel typography: a system serif, rasterized and thresholded, with no antialiasing.
import { makeCanvas } from "./pixel.js";

const SERIF = '"Palatino Linotype", "Book Antiqua", Georgia, serif';
export const FONTS = Object.freeze({
  letter: `bold 17px ${SERIF}`,
  word: `bold 16px ${SERIF}`,
  number: `bold 15px ${SERIF}`,
  title: `bold 23px ${SERIF}`,
});

/** Below this alpha the pixel is turned off: higher = thinner strokes. */
const ALPHA_THRESHOLD = 110;

let scratch = null;
const measure = () => (scratch ??= makeCanvas(1, 1).getContext("2d"));

const glyphs = new Map();
const capHeights = new Map();

function glyph(ch, font) {
  const key = font + ch;
  const cached = glyphs.get(key);
  if (cached) return cached;

  const g0 = measure();
  g0.font = font;
  const m = g0.measureText(ch);
  const ox = Math.ceil(m.actualBoundingBoxLeft) + 1;
  const oy = Math.ceil(m.actualBoundingBoxAscent) + 1;
  const canvas = makeCanvas(
    Math.max(1, ox + Math.ceil(m.actualBoundingBoxRight) + 1),
    Math.max(1, oy + Math.ceil(m.actualBoundingBoxDescent) + 1),
  );
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.font = font;
  g.fillText(ch, ox, oy);
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
    image.data[i + 3] = image.data[i + 3] >= ALPHA_THRESHOLD ? 255 : 0;
  }
  g.putImageData(image, 0, 0);

  const result = { canvas, ox, oy, advance: Math.round(m.width), tints: new Map() };
  glyphs.set(key, result);
  return result;
}

function capHeight(font) {
  if (!capHeights.has(font)) {
    const g = measure();
    g.font = font;
    capHeights.set(font, Math.round(g.measureText("H").actualBoundingBoxAscent));
  }
  return capHeights.get(font);
}

function tinted(mask, color) {
  let canvas = mask.tints.get(color);
  if (!canvas) {
    canvas = makeCanvas(mask.canvas.width, mask.canvas.height);
    const g = canvas.getContext("2d");
    g.drawImage(mask.canvas, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    mask.tints.set(color, canvas);
  }
  return canvas;
}

/** Width of `text` as drawString draws it, in pixels. */
export function textWidth(text, font, spacing = 0) {
  const masks = [...text].map((ch) => glyph(ch, font));
  return masks.reduce((sum, mask) => sum + mask.advance, 0) + spacing * (masks.length - 1);
}

/** Draws `text` centered at (cx, cy), with the capitals vertically centered. */
export function drawString(g, text, cx, cy, font, color, spacing = 0) {
  const baseline = Math.round(cy + capHeight(font) / 2);
  let pen = Math.round(cx - textWidth(text, font, spacing) / 2);
  for (const ch of text) {
    const mask = glyph(ch, font);
    g.drawImage(tinted(mask, color), pen - mask.ox, baseline - mask.oy);
    pen += mask.advance + spacing;
  }
}
