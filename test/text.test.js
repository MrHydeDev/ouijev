import assert from "node:assert/strict";
import { test } from "node:test";

import { toBoardText } from "../src/text.js";

test("uppercases and strips accents, but keeps the Ñ", () => {
  assert.equal(toBoardText("Mañana quizás cigüeña"), "MAÑANA QUIZAS CIGUEÑA");
});

test("a decomposed Ñ (N + combining tilde) is still an Ñ, and nothing else becomes one", () => {
  assert.equal(toBoardText("man\u0303ana"), "MAÑANA");
  assert.equal(toBoardText("a\u0001b"), "A B");
});

test("turns punctuation and symbols into single spaces, but an apostrophe doesn't split the word", () => {
  assert.equal(toBoardText("  ¿Tu   sombra?! "), "TU SOMBRA");
  assert.equal(toBoardText("l'ombre-noire"), "LOMBRE NOIRE");
  assert.equal(toBoardText("I don’t know"), "I DONT KNOW");
  assert.equal(toBoardText("don‘t shouldnʼt"), "DONT SHOULDNT");
});

test("spells the Latin letters that don't decompose the way their languages do without them", () => {
  assert.equal(toBoardText("Straße"), "STRASSE");
  assert.equal(toBoardText("Ærø Œuvre Łódź Þór"), "AERO OEUVRE LODZ THOR");
  // With an accent on top as well
  assert.equal(toBoardText("Ǽ Ǿrsted"), "AE ORSTED");
});

test("keeps numbers and accepts non-string values", () => {
  assert.equal(toBoardText("año 1984"), "AÑO 1984");
  assert.equal(toBoardText(42), "42");
  assert.equal(toBoardText(""), "");
});
