// Browser console tools (only with ?debug in the URL).
import { makeCanvas } from "./pixel.js";
import { FRAME_MS } from "./seance.js";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/** An element's rectangle in snapshot space (k = snapshot pixels per CSS pixel). */
const rectOf = (element, k) => {
  const r = element.getBoundingClientRect();
  return { x: r.left * k, y: r.top * k, width: r.width * k, height: r.height * k };
};

const scaledFont = (style, k) =>
  `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * k}px ${style.fontFamily}`;

function drawText(g, element, k, { align = "center", glow } = {}) {
  let text = element.textContent;
  // Elements without a box (display: none, like .author__text on a narrow board) aren't on screen
  if (!text || !element.getClientRects().length) return;
  const style = getComputedStyle(element);
  const r = rectOf(element, k);
  g.save();
  g.font = scaledFont(style, k);
  g.letterSpacing = style.letterSpacing === "normal" ? "0px" : `${parseFloat(style.letterSpacing) * k}px`;
  // Like text-overflow: ellipsis, which also aligns the line it cuts to the start
  if (style.textOverflow === "ellipsis" && g.measureText(text).width > r.width) {
    while (text && g.measureText(`${text}…`).width > r.width) text = text.slice(0, -1);
    text += "…";
    align = "left";
  }
  g.fillStyle = style.color;
  g.textAlign = align;
  g.textBaseline = "middle";
  if (glow) Object.assign(g, { shadowColor: glow, shadowBlur: 12 * k });
  g.fillText(text, align === "center" ? r.x + r.width / 2 : r.x, r.y + r.height / 2);
  g.restore();
}

/** An element's background and border (the same on every side), with its rounded corners. */
function drawBox(g, element, k) {
  const style = getComputedStyle(element);
  const r = rectOf(element, k);
  const border = parseFloat(style.borderTopWidth) * k;
  // As in CSS, a radius too big for the box is cut down to fit it (that's how a pill is made)
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) * k, r.width / 2, r.height / 2);
  g.fillStyle = style.backgroundColor;
  g.beginPath();
  g.roundRect(r.x, r.y, r.width, r.height, radius);
  g.fill();
  if (!border) return;
  // The stroke is centered on its path, so the path runs through the middle of the border
  const inset = border / 2;
  g.strokeStyle = style.borderTopColor;
  g.lineWidth = border;
  g.beginPath();
  g.roundRect(r.x + inset, r.y + inset, r.width - border, r.height - border, Math.max(0, radius - inset));
  g.stroke();
}

/** The signature: the photo with the same crop and filter as in the CSS, plus the name and website. */
async function drawAuthor(g, k) {
  const photo = document.querySelector(".author__photo");
  const style = getComputedStyle(photo);
  const r = rectOf(photo, k);
  const image = await loadImage(photo.currentSrc || photo.src);
  // object-fit: cover, positioned by object-position (in percentages)
  const [cropX, cropY] = style.objectPosition.split(" ").map((value) => parseFloat(value) / 100);
  const scale = Math.max(r.width / image.naturalWidth, r.height / image.naturalHeight);
  const sw = r.width / scale;
  const sh = r.height / scale;
  g.save();
  g.filter = style.filter;
  g.imageSmoothingEnabled = true;
  g.drawImage(
    image,
    (image.naturalWidth - sw) * cropX,
    (image.naturalHeight - sh) * cropY,
    sw,
    sh,
    r.x,
    r.y,
    r.width,
    r.height,
  );
  g.restore();
  const border = parseFloat(style.borderTopWidth) * k;
  g.strokeStyle = style.borderTopColor;
  g.lineWidth = border;
  g.strokeRect(r.x + border / 2, r.y + border / 2, r.width - border, r.height - border);
  for (const line of document.querySelectorAll(".author__text b, .author__text i")) {
    drawText(g, line, k, { align: "left" });
  }
}

/** Paints the seance plate, the controls and the language switch, which are HTML and don't appear on the canvas. */
async function drawInterface(g, ui, textures, k) {
  drawBox(g, ui.seance, k);
  drawText(g, ui.asked, k);
  drawText(g, ui.answer, k, { glow: "rgba(60, 255, 170, 0.6)" });
  await drawAuthor(g, k);

  g.imageSmoothingEnabled = false;
  for (const [control, texture] of [
    [ui.input, textures().input],
    [ui.button, textures().button],
  ]) {
    const r = rectOf(control, k);
    g.drawImage(await loadImage(texture), r.x, r.y, r.width, r.height);
  }
  const input = ui.input;
  const placeholder = !input.value;
  const style = getComputedStyle(input, placeholder ? "::placeholder" : null);
  const r = rectOf(input, k);
  g.save();
  g.font = scaledFont(style, k);
  g.fillStyle = style.color;
  g.textBaseline = "middle";
  g.fillText(
    input.value || input.placeholder,
    r.x + parseFloat(getComputedStyle(input).paddingLeft) * k,
    r.y + r.height / 2,
  );
  g.restore();

  drawBox(g, ui.language, k);
  for (const link of ui.language.querySelectorAll("a")) {
    drawBox(g, link, k);
    drawText(g, link, k);
  }
}

export function install({ seance, fog, tick, draw, flushLayout, ui, textures }) {
  window.ouijev = {
    seance,
    fog,

    /** Advances the animation by `ms` milliseconds at once (useful in background tabs). */
    simulate(ms) {
      // Like a frame: a pending layout (after a resize or a language switch) goes first
      flushLayout();
      for (let t = 0; t < ms; t += FRAME_MS) tick(FRAME_MS);
      draw();
    },

    /**
     * Captures the scene as a data URL: the fog with the board on top and, if `withInterface`, also the
     * seance plate, the controls and the language switch. Those are HTML, so they're redrawn from their computed
     * styles, as an approximation: one line per text, a simple glow, no shadows and no #status.
     *
     * @param {{ scale?: number, withInterface?: boolean }} [options] `scale` in snapshot pixels per board pixel
     */
    async snapshot({ scale = 2, withInterface = false } = {}) {
      flushLayout();
      draw();
      const pixel = ui.board.getBoundingClientRect().width / ui.board.width; // CSS pixels per board pixel
      const k = scale / pixel;
      const view = ui.fog.getBoundingClientRect();
      const canvas = makeCanvas(Math.round(view.width * k), Math.round(view.height * k));
      const g = canvas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(ui.fog, 0, 0, canvas.width, canvas.height);
      const board = rectOf(ui.board, k);
      g.drawImage(ui.board, board.x, board.y, board.width, board.height);
      if (withInterface) await drawInterface(g, ui, textures, k);
      return canvas.toDataURL();
    },
  };
  console.info("Ouijev: debug mode. Try `ouijev.simulate(3000)` or `await ouijev.snapshot({ withInterface: true })`.");
}
