import assert from "node:assert/strict";
import { test } from "node:test";

import { createDemoMedium } from "../src/medium/demo.js";
import { SeanceError } from "../src/medium/errors.js";
import { createMedium } from "../src/medium/medium.js";
import { WORDS } from "../src/medium/questions.js";
import { BOARD_WORDS, NONE, UNKNOWN_TEXT } from "../src/vocabulary.js";
import { collect, decision, fakeJev, hangUntilAborted, noul, ranking, searchScript, tinyLibrary } from "./helpers.js";

const fakeScribe = (propose) => ({ label: "Test scribe", propose });
/** The first decision; unless told otherwise, about a question with a factual answer. */
const first = (kind, language = "ES", { open = 0.1, topic = "WHAT" } = {}) => ({
  kind: decision(kind),
  language: decision(language),
  open: noul(open),
  topic: decision(topic),
});

/** Logger double that keeps every line as `[level, message]`, in order. */
function recordingLog() {
  const lines = [];
  const record = (level) => (message) => lines.push([level, message]);
  return { lines, error: record("error"), warn: record("warn"), info: record("info"), debug: record("debug") };
}

test("answers with their own spot on the board go straight through and cancel the scribe", async () => {
  let scribeSignal;
  const scribe = fakeScribe((_question, { signal }) => {
    scribeSignal = signal;
    return new Promise(() => {}); // never settles: it has to be canceled
  });
  const jev = fakeJev([first("YES")]);
  const events = await collect(createMedium({ jev, scribe, library: tinyLibrary() }).consult("¿Hay alguien?"));
  assert.deepEqual(events, [{ type: "word", word: "YES" }]);
  assert.ok(scribeSignal.aborted);
});

test("the scribe starts on its candidates while Jev takes the first decision, not after it", async () => {
  let proposed = false;
  let proposedBeforeDeciding;
  const scribe = fakeScribe(async () => {
    proposed = true;
    return { candidates: ["AZUL"] };
  });
  const jev = fakeJev([
    () => {
      proposedBeforeDeciding = proposed;
      return first(WORDS);
    },
    { answer: ranking({ AZUL: 0.9, [NONE]: 0.1 }) },
  ]);
  await collect(createMedium({ jev, scribe, library: tinyLibrary() }).consult("¿De qué color es el cielo?"));
  assert.equal(proposedBeforeDeciding, true);
});

test("the first decision asks at once for the kind of answer, the language, and if it's open and on what", async () => {
  const jev = fakeJev([first("GOODBYE", "EN")]);
  await collect(createMedium({ jev, library: tinyLibrary() }).consult("Goodbye"));
  assert.deepEqual(Object.keys(jev.requests[0].questions), ["kind", "language", "open", "topic"]);
  assert.equal(jev.requests[0].state.question, "Goodbye");
  assert.equal(jev.requests[0].state.spirit.name, "JEV");
});

test("with a scribe, Jev picks one of its candidates", async () => {
  const jev = fakeJev([first(WORDS), { answer: ranking({ AZUL: 0.8, GRIS: 0.15, [NONE]: 0.05 }) }]);
  const scribe = fakeScribe(async () => ({ candidates: ["AZUL", "GRIS"] }));
  const events = await collect(
    createMedium({ jev, scribe, library: tinyLibrary() }).consult("¿De qué color es el cielo?"),
  );
  assert.deepEqual(events, [{ type: "letters", text: "AZUL" }]);
  assert.deepEqual(Object.keys(jev.requests[1].questions.answer.criteria), ["AZUL", "GRIS", NONE]);
});

test("\"none of these\" only wins when Jev is sure, and then the spirit doesn't know, in the question's language", async () => {
  const run = async (probabilities, { language = "ES", unknown } = {}) => {
    const jev = fakeJev([first(WORDS, language), { answer: ranking(probabilities) }]);
    const scribe = fakeScribe(async () => ({ candidates: ["NADA", "LUZ"], unknown }));
    return (await collect(createMedium({ jev, scribe, library: tinyLibrary() }).consult("?")))[0].text;
  };
  assert.equal(await run({ [NONE]: 0.3, NADA: 0.25, LUZ: 0.2 }), "NADA");
  assert.equal(await run({ [NONE]: 0.49, NADA: 0.3, LUZ: 0.21 }), "NADA");
  assert.equal(await run({ [NONE]: 0.5, NADA: 0.3, LUZ: 0.2 }), UNKNOWN_TEXT.es);
  assert.equal(await run({ [NONE]: 0.7, NADA: 0.2, LUZ: 0.1 }), UNKNOWN_TEXT.es);
  assert.equal(await run({ [NONE]: 0.7, NADA: 0.2 }, { language: "OTHER" }), UNKNOWN_TEXT.en);
  // In a language Jev can't read on its own, only the scribe knows how to say it
  assert.equal(
    await run({ [NONE]: 0.7, NADA: 0.2 }, { language: "LATIN", unknown: "JE NE SAIS PAS" }),
    "JE NE SAIS PAS",
  );
});

test("without a scribe, a factual answer is in the word list of the question's language (English for any other)", async () => {
  const run = async (language, word) => {
    const jev = fakeJev([first(WORDS, language), ...searchScript(word)]);
    return (await collect(createMedium({ jev, library: tinyLibrary() }).consult("?")))[0].text;
  };
  assert.equal(await run("ES", "LUNA"), "LUNA");
  assert.equal(await run("EN", "MOON"), "MOON");
  assert.equal(await run("LATIN", "SHADOW"), "SHADOW");
  // A word only the other list has isn't found: the spirit doesn't know
  assert.equal(await run("OTHER", "LUNA"), UNKNOWN_TEXT.en);
});

test("an open question's answer is in the phrasebook: on its topic first, then the rest, then the word list", async () => {
  const run = async (word, { language = "ES", topic = "WHO", open = 0.9 } = {}) => {
    const jev = fakeJev([first(WORDS, language, { open, topic }), ...searchScript(word)]);
    const [{ text }] = await collect(createMedium({ jev, library: tinyLibrary() }).consult("?"));
    return { text, readFirst: Object.keys(jev.requests[1].questions.b0.criteria) };
  };
  assert.deepEqual(await run("TU SOMBRA"), { text: "TU SOMBRA", readFirst: ["TU SOMBRA", "NADIE", NONE] });
  assert.equal((await run("PRONTO")).text, "PRONTO");
  // From a 50% yes on, the question is open; below it, the word list comes first
  assert.deepEqual((await run("NADIE", { open: 0.5 })).readFirst, ["TU SOMBRA", "NADIE", NONE]);
  assert.equal((await run("NADIE", { open: 0.49 })).readFirst.length, 250);
  assert.equal((await run("LUNA")).text, "LUNA");
  // Like the word lists, any other language gets the English phrasebook
  assert.deepEqual(await run("BEHIND YOU", { language: "LATIN", topic: "WHERE" }), {
    text: "BEHIND YOU",
    readFirst: ["BEHIND YOU", NONE],
  });
});

test("if the scribe fails, Jev answers on its own, after a warning that says which scribe failed and why", async () => {
  const log = recordingLog();
  const jev = fakeJev([first(WORDS), ...searchScript("SOMBRA")]);
  // What fetch throws when nothing listens on localhost: the reason is only in the cause
  const refused = ["::1", "127.0.0.1"].map((address) => new Error(`connect ECONNREFUSED ${address}:11434`));
  const scribe = fakeScribe(async () => {
    throw new TypeError("fetch failed", { cause: new AggregateError(refused) });
  });
  const events = await collect(createMedium({ jev, scribe, library: tinyLibrary(), log }).consult("¿Quién anda ahí?"));
  assert.deepEqual(events, [{ type: "letters", text: "SOMBRA" }]);
  assert.deepEqual(log.lines.slice(0, 2), [
    ["info", `\n"¿Quién anda ahí?" → ${WORDS} (90%) · ES · factual (90%)`],
    [
      "warn",
      "  No candidates from Test scribe (fetch failed: connect ECONNREFUSED ::1:11434, connect ECONNREFUSED " +
        "127.0.0.1:11434); Jev will answer on its own.",
    ],
  ]);
});

test("a scribe that proposes nothing usable gets the same warning", async () => {
  const log = recordingLog();
  const jev = fakeJev([first(WORDS), ...searchScript("SOMBRA")]);
  const scribe = fakeScribe(async () => ({ candidates: [] }));
  await collect(createMedium({ jev, scribe, library: tinyLibrary(), log }).consult("¿Quién anda ahí?"));
  assert.deepEqual(log.lines[1], [
    "warn",
    "  No candidates from Test scribe (none usable); Jev will answer on its own.",
  ]);
});

test("a scribe failure goes unreported when the answer has its own spot", async () => {
  const log = recordingLog();
  const jev = fakeJev([first("YES")]);
  const scribe = fakeScribe(async () => {
    throw new Error("fake 401");
  });
  await collect(createMedium({ jev, scribe, library: tinyLibrary(), log }).consult("¿Hay alguien?"));
  assert.deepEqual(log.lines, [["info", '\n"¿Hay alguien?" → YES (90%) · ES']]);
});

test("the console narrates the search: the kind of question, what Jev read and how the finalists did", async () => {
  const narrate = async (question, open, word) => {
    const log = recordingLog();
    const jev = fakeJev([first(WORDS, "ES", { open, topic: "WHEN" }), ...searchScript(word)]);
    await collect(createMedium({ jev, library: tinyLibrary(), log }).consult(question));
    return log.lines.map(([, message]) => message);
  };
  assert.deepEqual(await narrate("¿Qué ilumina?", 0.1, "LUZ"), [
    '\n"¿Qué ilumina?" → WORDS (90%) · ES · factual (90%)',
    "  Jev read 258 words; finalists: LUZ 90%",
  ]);
  assert.deepEqual(await narrate("¿Cuándo?", 0.8, "PRONTO"), [
    '\n"¿Cuándo?" → WORDS (90%) · ES · open (80%), WHEN',
    "  Jev read 2 phrases; finalists: PRONTO 90%",
  ]);
});

test("a client's SeanceError reaches the user as it is, and anything else as one without internals", async () => {
  const failing = (err) => ({
    async systemOne() {
      throw err;
    },
  });
  const consult = (err) => collect(createMedium({ jev: failing(err), library: tinyLibrary() }).consult("¿Hola?"));
  const translated = new SeanceError("jev_unreachable", "Could not reach Jev.", { status: 504 });
  await assert.rejects(consult(translated), (err) => err === translated);
  const bug = new TypeError("ECONNRESET at secret.js:42");
  await assert.rejects(consult(bug), (err) => {
    assert.ok(err instanceof SeanceError);
    assert.deepEqual([err.code, err.status, err.cause], ["spirit_silent", 500, bug]);
    assert.doesNotMatch(err.message, /ECONNRESET|secret/);
    return true;
  });
});

test("a canceled seance ends silently", async () => {
  const abort = new AbortController();
  const jev = {
    async systemOne() {
      abort.abort();
      throw new Error("canceled");
    },
  };
  const medium = createMedium({ jev, library: tinyLibrary() });
  assert.deepEqual(await collect(medium.consult("¿Hola?", { signal: abort.signal })), []);
});

test("the demo medium answers in the interface's language, with the same events", async () => {
  const wait = async () => {};
  const demo = (random) => createDemoMedium({ random: () => random, wait });
  assert.deepEqual(await collect(demo(0).consult("?", { lang: "es" })), [{ type: "word", word: BOARD_WORDS[0] }]);
  const spelled = async (lang) => (await collect(demo(0.99).consult("?", { lang }))).map((e) => e.text).join("");
  assert.equal(await spelled("es"), "AQUI");
  assert.equal(await spelled("en"), "HERE");
  assert.equal(await spelled(undefined), "HERE");
  assert.equal(await spelled("fr"), "HERE");
  const letters = await collect(demo(0.99).consult("?"));
  assert.ok(letters.every((e) => e.type === "letters" && e.text.length === 1));
});

test("aborting the seance aborts the request to Jev in flight", async () => {
  const abort = new AbortController();
  let requestSignal;
  const jev = {
    systemOne: (_request, { signal }) => {
      requestSignal = signal;
      queueMicrotask(() => abort.abort());
      return hangUntilAborted(signal);
    },
  };
  const medium = createMedium({ jev, library: tinyLibrary() });
  assert.deepEqual(await collect(medium.consult("¿Hola?", { signal: abort.signal })), []);
  assert.ok(requestSignal.aborted);
});

test("when the seance settles, whatever is still in flight is canceled too", async () => {
  // Stage two of the search makes two requests at once: one fails, and the other mustn't go on spending
  const words = Array.from({ length: 8000 }, (_, i) => `W${i}`);
  const signals = [];
  let calls = 0;
  const jev = {
    async systemOne(request, { signal }) {
      signals.push(signal);
      calls++;
      if (calls === 1) return { answers: first(WORDS) };
      if (calls === 2) return { answers: searchScript("ABSENT")[0](request) };
      if (calls === 3) throw new Error("fake 429");
      return hangUntilAborted(signal);
    },
  };
  const medium = createMedium({ jev, library: { ...tinyLibrary(), words: { es: words, en: words } } });
  await assert.rejects(collect(medium.consult("¿Qué?")), SeanceError);
  assert.equal(calls, 4);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("if the whole question takes too long, it's cut off with a clear error", async () => {
  const jev = { systemOne: (_request, { signal }) => hangUntilAborted(signal) };
  const medium = createMedium({ jev, library: tinyLibrary(), timeoutMs: 20 });
  await assert.rejects(collect(medium.consult("¿Hola?")), (err) => {
    assert.ok(err instanceof SeanceError);
    assert.equal(err.code, "seance_timeout");
    assert.equal(err.status, 504);
    // The log gets the cause: it has to say which time limit ran out
    assert.match(err.cause.message, /20 ms time limit/);
    return true;
  });
});
