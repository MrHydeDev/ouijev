// The board's scaling rule, which public/js/fit.js keeps free of the DOM so it can be tested here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseScale } from "../public/js/fit.js";

const NO_CORNER = { width: 0, height: 0 };

test("an integer scale when it fills most of the space, so every board pixel comes out square", () => {
  // 2.5 would fit: 2 fills 80% of it
  assert.equal(chooseScale({ width: 1150, height: 650, corner: NO_CORNER, dpr: 1 }), 2);
  // On a 2x screen the same space is 5 physical pixels per board pixel
  assert.equal(chooseScale({ width: 1150, height: 650, corner: NO_CORNER, dpr: 2 }), 5);
});

test("whatever fits when an integer scale would waste too much of a small window", () => {
  // 1.9 would fit: 1 fills barely half of it
  assert.equal(chooseScale({ width: 874, height: 494, corner: NO_CORNER, dpr: 1 }), 1.9);
});

test("never below the floor, however small the window", () => {
  assert.equal(chooseScale({ width: 50, height: 20, corner: NO_CORNER, dpr: 1 }), 0.5);
});

test("the board goes beside the corner switch or below it, whichever lets it be bigger", () => {
  const corner = { width: 200, height: 100 };
  // A tall window: below the corner it gets the full width, 2.17 (so 2); beside it, only 1.74
  assert.equal(chooseScale({ width: 1000, height: 2000, corner, dpr: 1 }), 2);
  // A short, wide window: beside the corner it gets the full height, 1.54; below it, only 1.15 (so 1)
  assert.equal(chooseScale({ width: 2000, height: 400, corner, dpr: 1 }), 400 / 260);
});
