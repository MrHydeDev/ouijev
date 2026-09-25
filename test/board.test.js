// The browser can't import src/, so the page keeps its own copy of the board: these tests keep the two in step.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SPOTS, WORD_SPOTS } from "../public/js/layout.js";
import { BOARD_WORDS } from "../src/vocabulary.js";
import { DIGITS, LETTERS, toBoardText } from "../src/text.js";

test("the page has a spot for every word, letter and digit the server can send", () => {
  assert.deepEqual(new Set(Object.keys(WORD_SPOTS)), new Set(BOARD_WORDS));
  assert.deepEqual(new Set(Object.keys(SPOTS)), new Set([...LETTERS, ...DIGITS]));
});

test("toBoardText, which cleans up the scribe's candidates, lets exactly the board's alphabet through", () => {
  const everyCharacter = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).join("");
  assert.deepEqual(new Set(toBoardText(everyCharacter)), new Set([...LETTERS, ...DIGITS, " "]));
});
