import assert from "node:assert/strict";
import { test } from "node:test";

import { FOG, GHOST_FOG } from "../public/js/palettes.js";

test("the fog's two ramps have the same steps, so it can shade from one to the other when the spirit comes", () => {
  assert.equal(GHOST_FOG.length, FOG.length);
});
