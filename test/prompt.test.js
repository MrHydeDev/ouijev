import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_CANDIDATES, parseProposal, scribeMessage } from "../src/scribe/prompt.js";

const proposal = (object) => JSON.stringify(object);

test("extracts the candidates even when they come wrapped in text or code fences", () => {
  const text =
    'Sure, here they are:\n```json\n{"candidates": ["Azul", "verde", "el vacío"], "unknown": "no lo sé"}\n```';
  assert.deepEqual(parseProposal(text), { candidates: ["AZUL", "VERDE", "EL VACIO"], unknown: "NO LO SE" });
});

test("finds the JSON even with braces in the preamble or inside its strings", () => {
  assert.deepEqual(parseProposal('Format {candidates}: {"candidates": ["Luz", "{rara}"]}').candidates, ["LUZ", "RARA"]);
  const tricky = `Here: ${proposal({ candidates: ['a "b} c', "luz"] })}`;
  assert.deepEqual(parseProposal(tricky).candidates, ["A B C", "LUZ"]);
});

test("gives up quickly on a flood of unbalanced braces", () => {
  const started = performance.now();
  assert.throws(() => parseProposal("{".repeat(100_000)), /contains no valid JSON/);
  // Timed here because the search is synchronous: the test timeout can't cut a slow one short
  assert.ok(performance.now() - started < 1000);
});

test("cleans up, dedupes and drops the board's own answers and overly long candidates", () => {
  const text = proposal({
    candidates: ["yes", "azul", "AZUL", "No lo sé", "I don't know", "Goodbye", "supercalifragilístico", "", 7],
  });
  assert.deepEqual(parseProposal(text).candidates, ["AZUL", "7"]);
  // Up to 16 letters and spaces: the 14 asked for, and some slack
  const lengths = proposal({ candidates: ["A".repeat(16), "B".repeat(17)] });
  assert.deepEqual(parseProposal(lengths).candidates, ["A".repeat(16)]);
});

test("never lets through the board's own answers in other languages, nor the option meaning none of them", () => {
  const text = proposal({ candidates: ["Sí", "Adiós", "Oui", "au revoir", "None of these", "LUZ"] });
  assert.deepEqual(parseProposal(text).candidates, ["LUZ"]);
});

test("drops anything that isn't text or a finite number (objects, arrays, null, booleans, 1e400)", () => {
  const text = '{"candidates": [{"word": "azul"}, null, true, ["LUZ"], 1e400, "gris"]}';
  assert.deepEqual(parseProposal(text).candidates, ["GRIS"]);
});

test("caps the number of candidates", () => {
  const many = Array.from({ length: 20 }, (_, i) => `word ${i}`);
  assert.equal(parseProposal(proposal({ candidates: many })).candidates.length, MAX_CANDIDATES);
});

test("the way to say \"I don't know\" is optional, and dropped if it doesn't fit the board", () => {
  assert.deepEqual(parseProposal(proposal({ candidates: ["LUZ"] })), { candidates: ["LUZ"] });
  assert.deepEqual(parseProposal(proposal({ candidates: ["LUZ"], unknown: ["?"] })), { candidates: ["LUZ"] });
  assert.equal(parseProposal(proposal({ candidates: ["LUZ"], unknown: "Je ne sais pas" })).unknown, "JE NE SAIS PAS");
});

test("fails with a clear message when there is no usable JSON", () => {
  assert.throws(() => parseProposal("I don't know what to tell you"), /contains no valid JSON/);
  assert.throws(() => parseProposal("{candidates: [}"), /contains no valid JSON/);
  assert.throws(() => parseProposal('{"answers": []}'), /"candidates"/);
});

test("also fails when none of the candidates survives the cleanup", () => {
  assert.throws(() => parseProposal('{"candidates": []}'), /nothing usable/);
  assert.throws(() => parseProposal('{"candidates": ["Yes", "No", null]}'), /nothing usable/);
});

test("the message spells out English when the board can't write the question's script", () => {
  for (const question of ["Какого цвета небо?", "さようなら", "Τι ώρα είναι;"]) {
    assert.match(scribeMessage(question), /^Answer in English\./, question);
  }
  // A word in another script inside a question in Latin letters doesn't change its language
  for (const question of [
    "¿Qué hay después?",
    "Quelle heure est-il ?",
    "Wie spät ist es?",
    "42?",
    "¿Qué significa 愛?",
  ]) {
    assert.match(scribeMessage(question), /^Answer in the language the question is written in\./, question);
  }
  assert.match(scribeMessage("¿Hola?"), /Question: ¿Hola\?$/);
});
