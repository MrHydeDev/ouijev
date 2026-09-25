import { setTimeout as sleep } from "node:timers/promises";

import { BOARD_WORDS } from "../vocabulary.js";

const CANNED_WORDS = {
  en: ["MAYBE", "NEVER", "SOON", "SHADOW", "MOON", "HUSH", "HERE"],
  es: ["QUIZAS", "NUNCA", "PRONTO", "SOMBRA", "LUNA", "CALLA", "AQUI"],
};
const answersIn = (lang) => [
  ...BOARD_WORDS.map((word) => ({ type: "word", word })),
  ...CANNED_WORDS[lang].map((text) => ({ type: "letters", text })),
];
const ANSWERS = Object.fromEntries(Object.keys(CANNED_WORDS).map((lang) => [lang, answersIn(lang)]));

/**
 * Fake medium to try the board without an API key: canned answers with dramatic pauses. With nobody to tell
 * the question's language, it answers in the interface's.
 *
 * @param {{ random?: () => number, wait?: (ms: number, signal: AbortSignal) => Promise<unknown> }} [options]
 * @returns {import("./medium.js").Medium}
 */
export function createDemoMedium({
  random = Math.random,
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
} = {}) {
  return {
    async *consult(_question, { signal = new AbortController().signal, lang = "en" } = {}) {
      const answers = ANSWERS[lang] ?? ANSWERS.en;
      const answer = answers[Math.floor(random() * answers.length)];
      try {
        await wait(1500, signal);
        if (answer.type === "word") {
          yield answer;
          return;
        }
        for (const letter of answer.text) {
          yield { type: "letters", text: letter };
          await wait(400, signal);
        }
      } catch (err) {
        if (!signal.aborted) throw err;
      }
    },
  };
}
