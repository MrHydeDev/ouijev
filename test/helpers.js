// Test doubles shared by the tests.
import assert from "node:assert/strict";

import { NONE } from "../src/vocabulary.js";

/** A library like the one in data/, in miniature. */
export const tinyLibrary = () => ({
  words: {
    es: ["AZUL", "AZOR", "LUNA", "LUZ", "SOMBRA", "JEV"],
    en: ["BLUE", "MOON", "LIGHT", "SHADOW", "JEV"],
  },
  phrasebooks: {
    es: {
      WHO: ["TU SOMBRA", "NADIE"],
      WHERE: ["DETRAS DE TI"],
      WHEN: ["PRONTO", "NUNCA"],
      WHY_HOW: ["POR MIEDO"],
      WHAT: ["NADA", "NADIE"],
    },
    en: {
      WHO: ["YOUR SHADOW", "NOBODY"],
      WHERE: ["BEHIND YOU"],
      WHEN: ["SOON", "NEVER"],
      WHY_HOW: ["OUT OF FEAR"],
      WHAT: ["NOTHING", "NOBODY"],
    },
  },
});

/**
 * TypeSafe client double: each call to `systemOne` consumes the next entry of the script, an `answers` object
 * or a function that builds it from the request. Like the real SDK, it only accepts one answer per question
 * asked, of that question's type, and a choice among that question's options.
 */
export function fakeJev(script) {
  const requests = [];
  return {
    requests,
    async systemOne(request) {
      requests.push(request);
      if (script.length === 0) throw new Error(`Unexpected request: ${JSON.stringify(Object.keys(request.questions))}`);
      const next = script.shift();
      const answers = typeof next === "function" ? next(request) : next;
      assert.deepEqual(Object.keys(answers).sort(), Object.keys(request.questions).sort());
      for (const [name, answer] of Object.entries(answers)) {
        const question = request.questions[name];
        assert.equal(answer.type, question.type, `"${name}" is a ${question.type} question`);
        if (answer.type === "choice") {
          assert.ok(
            Object.hasOwn(question.criteria, answer.choice),
            `"${answer.choice}" is not an option of "${name}"`,
          );
        }
      }
      return { answers };
    },
  };
}

export const decision = (choice) => ({ type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } });

export const ranking = (probabilities) => {
  const [[choice, confidence]] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { type: "choice", choice, confidence, probabilities };
};

export const noul = (probability) => ({ type: "noul", noul: probability });

/**
 * Jev reading: in each batch it votes for `word` if it's there (for none otherwise), and in the final choice
 * too, with a `confidence` chance that `word` answers the question, and little for the rest.
 */
const findsWord =
  (word, confidence = 0.9) =>
  (request) => {
    // The judgment's finalists, in the order of its yes/no questions (f0, f1…)
    const finalists = Object.keys(request.questions.best?.criteria ?? {}).filter((option) => option !== NONE);
    const answer = (name, question) =>
      question.type === "noul"
        ? noul(finalists[Number(name.slice(1))] === word ? confidence : 0.05)
        : decision(Object.hasOwn(question.criteria, word) ? word : NONE);
    return Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => [name, answer(name, question)]),
    );
  };

/** Enough `findsWord` answers for a whole search: the phrasebook and the word list, stage by stage. */
export const searchScript = (word, confidence) => Array.from({ length: 10 }, () => findsWord(word, confidence));

/**
 * Never settles until `signal` aborts, like a hung server. The interval keeps the event loop alive:
 * AbortSignal.timeout doesn't, and Node 22's test runner cancels a test that is waiting on nothing else.
 */
export const hangUntilAborted = (signal) =>
  new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    const keepAlive = setInterval(() => {}, 1000);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(keepAlive);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/** Fake `fetch` that records the requests and replies with whatever `respond` returns. */
export function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: new Headers(init.headers),
    };
    calls.push(call);
    const { status = 200, json } = await respond(call);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch, calls };
}
