// Draws a frame: the board, the lit letter and the planchette.
import { drawString } from "./font.js";
import { HEIGHT, WIDTH } from "./layout.js";
import { renderHalo } from "./pixel.js";
import { PLANCHETTE_ORIGIN } from "./planchette.js";

const LIT_TEXT = "#ffe9b0"; // white-hot: readable over the halo
const LIT_HALO_RADIUS = 16;
/** On words (YES, NO, GOODBYE) the halo repeats along their length, every this many pixels. */
const LIT_HALO_STEP = 10;
const LIT_HALO_PER_LETTER = 6;
const PLANCHETTE_HALO_RADIUS = 44;
/** The planchette halo is centered slightly below the viewing window, on the wooden body. */
const PLANCHETTE_HALO_DROP = 6;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ board: HTMLCanvasElement, planchette: HTMLCanvasElement }} sprites
 * @param {{ motion?: { reduced: boolean } }} [options] with reduced motion, no trembling or pulsing
 */
export function createScene(ctx, { board, planchette }, { motion = { reduced: false } } = {}) {
  const litHalo = renderHalo(LIT_HALO_RADIUS, "rgba(255, 50, 20, 0.55)", 1.5);
  const planchetteHalo = renderHalo(PLANCHETTE_HALO_RADIUS, "rgba(90, 255, 180, 0.5)", 1.7);
  const { x: ox, y: oy } = PLANCHETTE_ORIGIN;

  return {
    /**
     * @param {number} now
     * @param {import("./seance.js").Seance} seance
     */
    draw(now, seance) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(board, 0, 0);

      const lit = seance.lit;
      if (lit) {
        const half = lit.text.length > 1 ? lit.text.length * LIT_HALO_PER_LETTER : 0;
        // Whole steps on either side, so the halos stay centered on the word
        const reach = Math.floor(half / LIT_HALO_STEP) * LIT_HALO_STEP;
        for (let dx = -reach; dx <= reach; dx += LIT_HALO_STEP) {
          ctx.drawImage(litHalo, lit.x + dx - LIT_HALO_RADIUS, lit.y - LIT_HALO_RADIUS);
        }
        drawString(ctx, lit.text, lit.x, lit.y, lit.font, LIT_TEXT, lit.spacing);
      }

      const still = motion.reduced;
      const { x, y } = seance.position;
      const tremble = seance.trembling && !still ? Math.sin(now / 70) * 0.6 : 0;
      const px = Math.round(x + tremble);
      const py = Math.round(y);
      ctx.globalAlpha = seance.presence * (still ? 0.85 : 0.7 + 0.3 * Math.sin(now / 260));
      ctx.drawImage(planchetteHalo, px - PLANCHETTE_HALO_RADIUS, py - PLANCHETTE_HALO_RADIUS + PLANCHETTE_HALO_DROP);
      ctx.globalAlpha = 1;
      ctx.drawImage(planchette, px - ox, py - oy);
    },
  };
}
