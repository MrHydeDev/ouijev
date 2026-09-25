// Text normalization to the board's alphabet, shared by the server and the scripts.

const COMBINING_MARKS = /[\u0300-\u036f]/g;
// NFD splits Ñ into N + combining tilde (and it may arrive that way already): it's rebuilt before stripping the marks.
const DECOMPOSED_ENYE = /N\u0303/g;

// Latin letters NFD doesn't take apart, spelled the way their languages write them without them (ß already
// uppercases to SS). Replaced once the accents are off, so Ǽ ends up as AE too.
const LIGATURES = { Æ: "AE", Œ: "OE", Ø: "O", Ł: "L", Đ: "D", Ð: "D", Þ: "TH" };
const LIGATURE = new RegExp(`[${Object.keys(LIGATURES).join("")}]`, "g");
// An apostrophe, however typed, doesn't split the word: the board spells DONT, not DON T
const APOSTROPHES = /['‘’ʼ]/g;

/** The board's alphabet: the letters and digits with a spot of their own (public/js/layout.js draws the same). */
export const LETTERS = Object.freeze([..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"]);
export const DIGITS = Object.freeze([..."0123456789"]);
const OFF_THE_BOARD = new RegExp(`[^${LETTERS.join("")}${DIGITS.join("")} ]+`, "g");

/**
 * Reduces text to what the board can write: uppercase without accents (keeping Ñ), only A-Z, Ñ,
 * digits and single spaces.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function toBoardText(text) {
  return String(text)
    .toUpperCase()
    .normalize("NFD")
    .replace(DECOMPOSED_ENYE, "Ñ")
    .replace(COMBINING_MARKS, "")
    .replace(LIGATURE, (letter) => LIGATURES[letter])
    .replace(APOSTROPHES, "")
    .replace(OFF_THE_BOARD, " ")
    .replace(/ +/g, " ")
    .trim();
}
