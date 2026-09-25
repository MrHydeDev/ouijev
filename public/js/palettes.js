import { ramp } from "./pixel.js";

export const WOOD = ramp(["#4b2a12", "#7a4a22", "#a87038", "#cb9856", "#e6bf84"], 9);
export const WALNUT = ramp(["#1d0e06", "#3f2110", "#6e3f1f", "#a87040"], 7);
export const BRASS = ramp(["#2a1b07", "#8a6a20", "#ecc868", "#fff0b0"], 6);
export const FOG = ramp(["#0b0c0f", "#1f2228", "#3a3e46", "#5b6068", "#80858c", "#a9adb2", "#cfd2d5"], 10);
/** The fog shifts to this ramp when the spirit is present. */
export const GHOST_FOG = ramp(["#06100c", "#10281f", "#1f4a3a", "#357a5e", "#55a584", "#86cfae", "#c4f2dc"], 10);

export const INK = [30, 14, 5];
/** The wood seen through a crack. */
export const CRACK = [36, 18, 8];
