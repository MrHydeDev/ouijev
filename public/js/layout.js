// Scene geometry: where everything on the board sits, in canvas pixels.
import { FONTS } from "./font.js";
import { roundRectSdf } from "./pixel.js";

/** Native resolution, deliberately low: when scaled up, each pixel looks chunky. */
export const WIDTH = 460;
export const HEIGHT = 260;

/** The board within the scene. */
export const BOARD = Object.freeze({ x: 32, y: 16, width: 396, height: 228 });

/** Board-relative coordinates → scene coordinates. */
export const at = (x, y) => ({ x: BOARD.x + x, y: BOARD.y + y });

/** The board's vertical axis, in board coordinates: the title, the arcs, GOODBYE and the rest spot are centered on it. */
export const AXIS = BOARD.width / 2;

export const TITLE = "OUIJEV";

/** Where the planchette rests between questions (and where it returns for spaces). */
export const REST = Object.freeze(at(AXIS, 162));

/** Spots for the answers that aren't spelled out. The keys match the server's `word` events. */
export const WORD_SPOTS = Object.freeze({
  YES: { text: "YES", ...at(76, 24), font: FONTS.word, spacing: 2 },
  NO: { text: "NO", ...at(328, 24), font: FONTS.word, spacing: 2 },
  GOODBYE: { text: "GOODBYE", ...at(AXIS, 205), font: FONTS.word, spacing: 3 },
});

/** One spot per letter and digit: the letters sit in two arcs, as on a classic Ouija board. */
export const SPOTS = (() => {
  const spots = {};
  const arc = (chars, top, radius, halfAngle) => {
    const center = at(AXIS, top);
    [...chars].forEach((text, i) => {
      const angle = -halfAngle + (2 * halfAngle * i) / (chars.length - 1);
      spots[text] = {
        text,
        x: Math.round(center.x + radius * Math.sin(angle)),
        y: Math.round(center.y + radius * (1 - Math.cos(angle))),
        font: FONTS.letter,
      };
    });
  };
  arc("ABCDEFGHIJKLM", 62, 630, 0.265);
  arc("NÑOPQRSTUVWXYZ", 92, 582, 0.3);
  [..."1234567890"].forEach((text, i) => (spots[text] = { text, ...at(99 + i * 22, 130), font: FONTS.number }));
  return Object.freeze(spots);
})();

/** Depth of a pixel inside the board (negative outside): used for bevels and edges. */
export const boardDepth = (x, y) =>
  -roundRectSdf(x + 0.5, y + 0.5, BOARD.x, BOARD.y, BOARD.x + BOARD.width, BOARD.y + BOARD.height, 10);
