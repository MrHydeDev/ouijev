// Fits the scene to the window: picks the pixel size and sizes everything with it.
import { CONTROLS } from "./controls.js";
import { HEIGHT, WIDTH } from "./layout.js";

/** Horizontal margin left free around the scene, in CSS pixels. */
const SIDE_MARGIN = 24;
/** Vertical slack so that rounding doesn't cause a scrollbar. */
const VERTICAL_SLACK = 4;
/** An integer scale is only used if it fills at least this fraction of the scale that would fit. */
const MIN_INTEGER_FILL = 0.7;
/** Floor for the scale, in physical pixels per board pixel: a very short window would drive it to zero or below. */
const MIN_SCALE = 0.5;
/** Room left between the language switch and the scene, in CSS pixels. */
const SWITCH_CLEARANCE = 8;
/** Minimum control height in CSS pixels, so they can be tapped with a finger. */
const MIN_CONTROL_HEIGHT = 40;
/** Below 16 px, iOS zooms the page when typing in the input. */
const MIN_INPUT_FONT_SIZE = 16;

/**
 * The scale for the board, in physical pixels per board pixel: an integer one (with fractional factors the pixel
 * art looks uneven), unless it wastes too much of the space (in small windows, for example), in which case
 * whatever fits is used, down to MIN_SCALE (below that, the page scrolls). The scene never goes under the corner
 * the language switch takes: it fits either beside it or below it, whichever lets it be bigger.
 *
 * @param {object} space
 * @param {number} space.width CSS pixels available across
 * @param {number} space.height CSS pixels available for the board, once what goes below it is taken out
 * @param {{ width: number, height: number }} space.corner CSS pixels to keep clear across (beside) or down (below)
 * @param {number} space.dpr physical pixels per CSS pixel
 */
export function chooseScale({ width, height, corner, dpr }) {
  const fitting = (across, down) => Math.min(across / WIDTH, down / HEIGHT);
  const best = Math.max(
    MIN_SCALE,
    Math.max(fitting(width - corner.width, height), fitting(width, height - corner.height)) * dpr,
  );
  const integer = Math.floor(best);
  return integer / best >= MIN_INTEGER_FILL ? integer : best;
}

/**
 * Sizes the scene with chooseScale and publishes the result as `--px` on `main`, so the CSS can measure in
 * board pixels. On small screens the controls are made taller (in board pixels) so they can be tapped.
 *
 * @param {{ main: HTMLElement, board: HTMLCanvasElement, form: HTMLFormElement, input: HTMLElement, button: HTMLElement, language: HTMLElement }} elements
 * @returns {{ pixel: number, controlHeight: number }} CSS size of one board pixel and height of the
 *   controls in board pixels
 */
export function fitLayout({ main, board, form, input, button, language }) {
  const dpr = window.devicePixelRatio || 1;
  // The corner the switch takes, wherever the CSS puts it; the scene is centered, so it loses that room on both sides
  const rect = language.getBoundingClientRect();
  const corner = {
    width: 2 * (window.innerWidth - rect.left + SWITCH_CLEARANCE),
    height: 2 * (rect.bottom + SWITCH_CLEARANCE),
  };
  let pixel = 1;
  let controlHeight = CONTROLS.height;
  // Two passes: the height of what sits below the board depends on the scale, and the scale on that height
  for (let pass = 0; pass < 2; pass++) {
    const reserved = main.offsetHeight - board.offsetHeight + VERTICAL_SLACK;
    const width = window.innerWidth - SIDE_MARGIN;
    const height = window.innerHeight - reserved;
    pixel = chooseScale({ width, height, corner, dpr }) / dpr;
    controlHeight = Math.max(CONTROLS.height, Math.ceil(MIN_CONTROL_HEIGHT / pixel));

    main.style.width = `${WIDTH * pixel}px`;
    main.style.setProperty("--px", `${pixel}px`);
    // Controls measure a whole number of board pixels, so their texture doesn't get distorted
    form.style.gap = `${(WIDTH - CONTROLS.inputWidth - CONTROLS.buttonWidth) * pixel}px`;
    input.style.width = `${CONTROLS.inputWidth * pixel}px`;
    button.style.width = `${CONTROLS.buttonWidth * pixel}px`;
    input.style.height = button.style.height = `${controlHeight * pixel}px`;
    input.style.fontSize = `${Math.max(MIN_INPUT_FONT_SIZE, Math.round(CONTROLS.fontSize * pixel))}px`;
  }
  return { pixel, controlHeight };
}
