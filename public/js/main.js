// Entry point: sets up the scene, wires up the form and the language switch, and starts the animation loop.
import { consult, fetchStatus } from "./api.js";
import { renderBoard } from "./board.js";
import { paintControls } from "./controls.js";
import { fitLayout } from "./fit.js";
import { Fog } from "./fog.js";
import { errorMessage, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { HEIGHT, REST, SPOTS, WIDTH, WORD_SPOTS } from "./layout.js";
import { motion } from "./motion.js";
import { makeCanvas } from "./pixel.js";
import { renderPlanchette } from "./planchette.js";
import { createScene } from "./scene.js";
import { Seance } from "./seance.js";

/** Cap on a single animation step: if the tab freezes, the planchette doesn't jump. */
const MAX_STEP_MS = 50;
/** The server cuts off at 60 s; this is only in case it hangs completely. */
const REQUEST_TIMEOUT_MS = 90_000;

const byId = (id) => document.getElementById(id);
const ui = {
  main: document.querySelector("main"),
  board: byId("board"),
  fog: byId("fog"),
  seance: byId("seance"),
  form: byId("ask"),
  input: byId("question"),
  button: byId("send"),
  asked: byId("asked"),
  answer: byId("answer"),
  announcer: byId("announcer"),
  status: byId("status"),
  language: byId("language"),
};

/** The page's fixed texts, which only change with the language: element, property and key of the string. */
const FIXED_TEXTS = [
  [document.querySelector("h1"), "textContent", "heading"],
  [ui.board, "ariaLabel", "boardLabel"],
  [ui.seance, "ariaLabel", "seanceLabel"],
  [ui.input.labels[0], "textContent", "questionLabel"],
  [ui.input, "placeholder", "placeholder"],
  [ui.button, "textContent", "summon"],
  [ui.language, "ariaLabel", "languageLabel"],
];

ui.board.width = WIDTH;
ui.board.height = HEIGHT;

const planchette = renderPlanchette();
const scene = createScene(ui.board.getContext("2d"), { board: renderBoard(), planchette }, { motion });
const fog = new Fog(ui.fog, { motion });
const seance = new Seance({ spots: SPOTS, wordSpots: WORD_SPOTS, rest: REST, motion, onFinish: finishSeance });

// The state behind the texts that change, rather than the texts themselves, so they can be redone in another language
/** The question on the plate, or `null` before the first one. */
let asked = null;
/** Whether the server is in demo mode, which #status notes, and whether it has said yet. */
let demo = false;
let statusKnown = false;
/** The last failure, which replaces the demo notice until the next question. */
let failure = null;

function showAsked() {
  ui.asked.textContent = asked === null ? t("waiting") : t("asked", { question: asked });
  ui.asked.classList.toggle("waiting", asked === null);
}

function showStatus() {
  ui.status.textContent = failure
    ? errorMessage(failure.code, { max: String(ui.input.maxLength) })
    : demo
      ? t("demo")
      : "";
  ui.status.classList.toggle("error", failure !== null);
}

function setFailure(err) {
  failure = err;
  showStatus();
}

/** Asks the server which mode it's in; a failure shows, unless `quietly`. */
function checkStatus({ quietly = false } = {}) {
  fetchStatus()
    .then(({ mode }) => {
      statusKnown = true;
      demo = mode === "demo";
      showStatus();
    })
    .catch((err) => {
      if (!quietly) setFailure(err);
    });
}

/** Puts the page in the current language: at startup and on every switch. */
function localize() {
  for (const [element, property, key] of FIXED_TEXTS) element[property] = t(key);
  for (const link of ui.language.querySelectorAll("a")) {
    link.ariaCurrent = link.hreflang === getLanguage() ? "page" : null;
  }
  showAsked();
  showStatus();
}

// During the seance the form is locked without `disabled`, which would make it lose focus
function setBusy(busy) {
  ui.form.classList.toggle("busy", busy);
  ui.input.readOnly = busy;
  ui.button.ariaDisabled = String(busy);
}

function finishSeance() {
  ui.answer.classList.remove("asking");
  setBusy(false);
  // Screen readers hear the whole answer once, not letter by letter
  ui.announcer.textContent = seance.spelled ? t("answered", { answer: seance.spelled }) : "";
  if (document.activeElement === document.body) ui.input.focus();
}

async function ask(question) {
  seance.begin();
  asked = question;
  showAsked();
  ui.answer.classList.add("asking");
  ui.announcer.textContent = t("answering");
  setBusy(true);
  // Only an error is cleared: rewriting the notice would make #status announce it again
  if (failure) setFailure(null);
  // If the server couldn't be reached at startup (restarting, say), it may be answering now
  if (!statusKnown) checkStatus({ quietly: true });
  try {
    await consult(question, {
      lang: getLanguage(),
      onEvent: (event) => seance.receive(event),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    setFailure(err);
    // So it doesn't have to be typed again
    ui.input.value = question;
  } finally {
    seance.close();
  }
}

// --- Fitting to the window: on resize and when moving to a monitor with a different pixel density ---

let textures = null;
/** What the controls' textures were painted for: their height and the button's label. */
let painted = { height: 0, label: "" };
let layoutQueued = false;

function layout() {
  const { pixel, controlHeight } = fitLayout(ui);
  fog.resize(pixel);
  // The controls' wood is painted at the required height (not stretched), with the button's label in it
  const label = t("summon");
  if (controlHeight !== painted.height || label !== painted.label) {
    textures = paintControls(ui.input, ui.button, controlHeight, label);
    painted = { height: controlHeight, label };
  }
}

/** The layout is redone before the next paint, once however many changes arrive before it. */
function scheduleLayout() {
  layoutQueued = true;
}

/** Runs the pending layout, if there is one. Before painting: fog.resize() clears the fog canvas. */
function flushLayout() {
  if (!layoutQueued) return;
  layoutQueued = false;
  layout();
}

// --- Animation loop: its own clock, so it can also be advanced by hand (see debug.js) ---

let clock = 0;
let lastFrame = performance.now();
let shownAnswer = "";

function tick(dt) {
  clock += dt;
  seance.update(clock, dt);
  fog.update(dt, seance.presence);
}

function draw() {
  fog.draw(clock, seance.presence);
  scene.draw(clock, seance);
  if (seance.spelled !== shownAnswer) ui.answer.textContent = shownAnswer = seance.spelled;
}

function frame(now) {
  flushLayout();
  // The first `now` from requestAnimationFrame can be slightly earlier than `lastFrame`
  tick(Math.min(MAX_STEP_MS, Math.max(0, now - lastFrame)));
  lastFrame = now;
  draw();
  requestAnimationFrame(frame);
}

function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    "change",
    () => {
      scheduleLayout();
      watchPixelRatio();
    },
    { once: true },
  );
}

/** The favicon is the planchette itself, painted by the same code as the one in the scene. */
function setFavicon(sprite) {
  const size = Math.max(sprite.width, sprite.height);
  const icon = makeCanvas(size, size);
  icon.getContext("2d").drawImage(sprite, (size - sprite.width) >> 1, (size - sprite.height) >> 1);
  document.querySelector('link[rel="icon"]').href = icon.toDataURL();
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = ui.input.value.trim();
  if (!question || seance.active) return;
  ui.input.value = "";
  ask(question);
});
ui.language.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  // With a modifier key or another button it stays a plain link: to open the other language in a new tab, say
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  setLanguage(link.hreflang);
});
onLanguageChange(() => {
  localize();
  // The button's new label has to be painted into its wood
  scheduleLayout();
});
window.addEventListener("resize", scheduleLayout);
watchPixelRatio();

localize();
setFavicon(planchette);
layout();
requestAnimationFrame(frame);
// The fog takes a few hundred milliseconds to generate: after the first frame, and a layer at a time
requestAnimationFrame(() => fog.prepare());
checkStatus();

// With ?debug in the URL, `window.ouijev` lets you inspect the seance and advance the clock by hand.
if (new URLSearchParams(location.search).has("debug")) {
  import("./debug.js").then(({ install }) =>
    install({ seance, fog, tick, draw, flushLayout, ui, textures: () => textures }),
  );
}
