// The form is pixel art too: the input and the button are wooden pieces painted like the board.
import { drawString, FONTS } from "./font.js";
import { BRASS, WALNUT, WOOD } from "./palettes.js";
import { css, makeCanvas, roundRectSdf, tone } from "./pixel.js";
import { GRAIN, woodValue } from "./wood.js";

/** Control dimensions, in board pixels (`fit.js` uses them to scale the controls along with the board). */
export const CONTROLS = Object.freeze({ inputWidth: 334, buttonWidth: 122, height: 24, fontSize: 12 });

const BEVEL_RADIUS = 3;

/** Wooden piece with the same grain, bevel and dithering as the board. */
function renderPlate(width, height, palette, seed, label) {
  const canvas = makeCanvas(width, height);
  const g = canvas.getContext("2d");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const depth = -roundRectSdf(x + 0.5, y + 0.5, 0, 0, width, height, BEVEL_RADIUS);
      if (depth < 0) continue;
      const lightSide = Math.min(x, y) <= Math.min(width - 1 - x, height - 1 - y);
      let v = woodValue((x + seed * 131) * GRAIN, (y + seed * 71) * GRAIN);
      if (depth < 1.5) v = 0.08;
      else if (depth < 3.5) v += lightSide ? 0.2 : -0.24;
      g.fillStyle = tone(palette, v, x, y);
      g.fillRect(x, y, 1, 1);
    }
  }
  if (label) {
    // Brass label with a one-pixel shadow, like an engraving
    drawString(g, label, width / 2 + 1, height / 2 + 1, FONTS.letter, css(WALNUT[0]), 2);
    drawString(g, label, width / 2, height / 2, FONTS.letter, css(BRASS[4]), 2);
  }
  return canvas.toDataURL();
}

/**
 * Paints the wood of the input and the button.
 *
 * @param {HTMLInputElement} input
 * @param {HTMLButtonElement} button
 * @param {number} height height in board pixels (on small screens, taller than `CONTROLS.height`)
 * @param {string} label the button's text, painted in pixels
 * @returns {{ input: string, button: string }} the textures, as data URLs
 */
export function paintControls(input, button, height, label) {
  const textures = {
    input: renderPlate(CONTROLS.inputWidth, height, WOOD, 1),
    button: renderPlate(CONTROLS.buttonWidth, height, WALNUT, 2, label),
  };
  input.style.backgroundImage = `url(${textures.input})`;
  button.style.backgroundImage = `url(${textures.button})`;
  return textures;
}
