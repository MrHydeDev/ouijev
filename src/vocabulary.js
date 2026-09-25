// The spirit and the vocabulary the medium and the scribe share. The spirit answers in the language of the
// question, but the board's own spots are the classic English ones (public/js/layout.js draws the same words).

/**
 * What the spirit knows about itself. Jev and the scribe both get it, so personal questions ("what's your
 * name?") have an answer. It lives in a machine: as a plain AI model, Jev answers NO to "are you a spirit?".
 */
export const SPIRIT = Object.freeze({
  name: "JEV",
  origin: "TYPESAFE",
  nature: "A SPIRIT THAT LIVES IN A MACHINE",
  age: "1",
  character: "mocking and cryptic",
});

/** Answers with their own spot on the board: the planchette goes straight there. */
export const BOARD_WORDS = Object.freeze(["YES", "NO", "GOODBYE"]);

/**
 * The board words and their usual translations, as board text. They are never spelled out: those answers
 * belong to the spots, which the first decision already chose between.
 */
export const SPOT_ANSWERS = Object.freeze([
  ...BOARD_WORDS,
  ...["SI", "ADIOS", "OUI", "NON", "AU REVOIR", "JA", "NEIN", "SIM", "NAO", "ADEUS", "ARRIVEDERCI"],
]);

/**
 * The option of Jev's choices meaning none of the others works. It has a space, so no word in a word list can
 * clash with it; no phrase in a phrasebook is it, and the scribe's candidates can't be it.
 */
export const NONE = "NONE OF THESE";

/** The languages with a word list and a phrasebook, the ones Jev can answer in on its own. */
export const LANGUAGES = Object.freeze(["es", "en"]);

/** What an open question can be about: the phrasebooks group their phrases by these. */
export const TOPICS = Object.freeze(["WHO", "WHERE", "WHEN", "WHY_HOW", "WHAT"]);

/** "I don't know" as the board spells it (it has no apostrophe). */
export const UNKNOWN_TEXT = Object.freeze({ es: "NO LO SE", en: "I DONT KNOW" });

/** Words the spirit needs that the word lists lack: its name and origin, and a few too short for them. */
export const EXTRA_WORDS = Object.freeze({
  es: Object.freeze([SPIRIT.name, SPIRIT.origin, "YO", "TU"]),
  en: Object.freeze([SPIRIT.name, SPIRIT.origin, "ME"]),
});
