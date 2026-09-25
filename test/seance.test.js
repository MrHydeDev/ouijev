// The frontend state machine doesn't touch the DOM, so it's tested in Node.
import assert from "node:assert/strict";
import { test } from "node:test";

import { WORD_SPOTS } from "../public/js/layout.js";
import { FRAME_MS, HOLD_MS, Seance } from "../public/js/seance.js";

const REST = { x: 100, y: 100 };
const SPOTS = { A: { text: "A", x: 20, y: 20 }, B: { text: "B", x: 180, y: 20 } };

function run(seance, ms, { from = 0 } = {}) {
  let now = from;
  for (; now < from + ms; now += FRAME_MS) seance.update(now, FRAME_MS);
  return now;
}

const newSeance = (options) => new Seance({ spots: SPOTS, wordSpots: WORD_SPOTS, rest: REST, ...options });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("the planchette visits the letters in order, lights them up and finishes when the stream closes", () => {
  let finished = 0;
  const seance = newSeance({ onFinish: () => finished++ });
  seance.begin();
  seance.receive({ type: "letters", text: "AB" });
  seance.close();

  const lit = new Set();
  let now = 0;
  while (seance.active && now < 20_000) {
    now = run(seance, FRAME_MS, { from: now });
    if (seance.lit) lit.add(seance.lit.text);
  }
  assert.equal(seance.spelled, "AB");
  assert.deepEqual([...lit], ["A", "B"]);
  assert.equal(finished, 1);
  assert.equal(seance.active, false);
});

test("each of the server's words goes straight to its own spot on the board, in a single move", () => {
  for (const word of ["YES", "NO", "GOODBYE"]) {
    const seance = newSeance();
    seance.begin();
    seance.receive({ type: "word", word });
    seance.close();
    const spelled = new Set();
    const lit = new Set();
    let now = 0;
    while (seance.active && now < 20_000) {
      now = run(seance, FRAME_MS, { from: now });
      spelled.add(seance.spelled);
      if (seance.lit) lit.add(seance.lit);
    }
    assert.deepEqual([...spelled], ["", word]);
    assert.deepEqual([...lit], [WORD_SPOTS[word]]);
  }
});

test("spaces send the planchette back to the center and are kept in the spelled text", () => {
  const seance = newSeance();
  seance.begin();
  seance.receive({ type: "letters", text: "A B" });
  seance.close();
  // Between A and B (a straight line far from the center), how close it gets to the center
  let closest = Infinity;
  let now = 0;
  while (seance.active && now < 20_000) {
    now = run(seance, FRAME_MS, { from: now });
    if (seance.spelled.startsWith("A") && !seance.spelled.includes("B")) {
      closest = Math.min(closest, distance(seance.position, REST));
    }
  }
  assert.equal(seance.spelled, "A B");
  assert.ok(closest < 1, `it only came within ${closest} of the center`);
});

test("a repeated letter forces the planchette to move away and come back", () => {
  const seance = newSeance();
  seance.begin();
  seance.receive({ type: "letters", text: "AA" });
  seance.close();
  // After the first A, the planchette has to leave the spot before coming back to it
  let now = 0;
  let leftSpot = false;
  while (seance.spelled.length < 2 && now < 30_000) {
    now = run(seance, FRAME_MS, { from: now });
    if (seance.spelled === "A" && distance(seance.position, SPOTS.A) > 5) leftSpot = true;
  }
  assert.equal(seance.spelled, "AA");
  assert.ok(leftSpot);
});

test("while waiting for the first letter the planchette wanders restlessly, and the presence rises and falls", () => {
  const seance = newSeance();
  seance.begin();
  let now = run(seance, 2000);
  assert.ok(seance.presence > 0.9);
  // `position` is the live object, hence the copy
  const before = { ...seance.position };
  now = run(seance, 500, { from: now });
  assert.ok(distance(seance.position, before) > 3);
  seance.close();
  run(seance, 5000, { from: now });
  assert.equal(seance.active, false);
  assert.ok(seance.presence < 0.1);
});

test("with reduced motion the planchette neither sways at rest nor wanders while waiting", () => {
  const seance = newSeance({ motion: { reduced: true } });
  let now = run(seance, 1000);
  assert.deepEqual(seance.position, REST);
  seance.begin();
  now = run(seance, 3000, { from: now });
  const waiting = { ...seance.position };
  now = run(seance, 1000, { from: now });
  assert.deepEqual(seance.position, waiting);
  seance.close();
  run(seance, 5000, { from: now });
  assert.equal(seance.active, false);
  assert.deepEqual(seance.position, REST);
});

test("the planchette trembles from the first letter until the seance ends", () => {
  const seance = newSeance();
  seance.begin();
  const now = run(seance, 1000);
  assert.equal(seance.trembling, false);
  seance.receive({ type: "letters", text: "A" });
  assert.equal(seance.trembling, true);
  seance.close();
  run(seance, 5000, { from: now });
  assert.equal(seance.active, false);
  assert.equal(seance.trembling, false);
});

test("each letter is held for HOLD_MS before moving on to the next", () => {
  const seance = newSeance();
  seance.begin();
  seance.receive({ type: "letters", text: "AB" });
  let now = 0;
  while (!seance.lit && now < 10_000) now = run(seance, FRAME_MS, { from: now });
  const litAt = now;
  // While A is lit the planchette stays on it...
  while (now < litAt + HOLD_MS - 2 * FRAME_MS) {
    now = run(seance, FRAME_MS, { from: now });
    assert.ok(distance(seance.position, SPOTS.A) < 1, `left A after ${now - litAt} ms`);
  }
  // ...and lets go of it right after HOLD_MS
  while (seance.lit && now < litAt + 5000) now = run(seance, FRAME_MS, { from: now });
  const held = now - litAt;
  assert.ok(held >= HOLD_MS - FRAME_MS && held <= HOLD_MS + FRAME_MS, `held for ${held} ms`);
});

test("ignores events outside a seance and letters that aren't on the board", () => {
  const seance = newSeance();
  seance.receive({ type: "letters", text: "A" });
  // With the clock running: queued, it would be spelled
  run(seance, 3000);
  assert.equal(seance.spelled, "");
  seance.begin();
  seance.receive({ type: "letters", text: "¿?" });
  seance.receive({ type: "word", word: "MAYBE" });
  seance.close();
  run(seance, 3000);
  assert.equal(seance.spelled, "");
  assert.equal(seance.active, false);
});
