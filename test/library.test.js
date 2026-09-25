import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { isBlocked } from "../scripts/blocklist.js";
import { loadLibrary } from "../src/medium/library.js";
import { EXTRA_WORDS, LANGUAGES, NONE, SPOT_ANSWERS, TOPICS } from "../src/vocabulary.js";

/** Spelling takes about a second a letter: a longer phrase keeps the person waiting too long. */
const MAX_PHRASE_LENGTH = 20;

const EMPTY_PHRASEBOOK = TOPICS.map((topic) => `# ${topic}\n`).join("");

/** Loads a library from a temporary data/ with these files, the missing ones empty. */
async function loadFrom(files) {
  const dir = await mkdtemp(join(tmpdir(), "ouijev-"));
  try {
    for (const lang of LANGUAGES) {
      await writeFile(join(dir, `words-${lang}.txt`), files[`words-${lang}.txt`] ?? "");
      await writeFile(join(dir, `phrasebook-${lang}.txt`), files[`phrasebook-${lang}.txt`] ?? EMPTY_PHRASEBOOK);
    }
    return await loadLibrary(pathToFileURL(`${dir}/`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a word list keeps its order, puts the extra words first and has no blanks, repeats or spot answers", async () => {
  const { words } = await loadFrom({ "words-es.txt": `LUNA\r\n LUZ \n\nLUNA\nSI\n${EXTRA_WORDS.es[0]}\n` });
  assert.deepEqual(words.es, [...EXTRA_WORDS.es, "LUNA", "LUZ"]);
  assert.deepEqual(words.en, EXTRA_WORDS.en);
});

test("a phrasebook comes out as board text, by topic, in order and without repeats", async () => {
  const { phrasebooks } = await loadFrom({
    "phrasebook-es.txt": "# WHO\r\nTu cuñado\n\n  Nadie \n# WHEN\nMañana\n# WHO\nNadie\nEl de arriba\n",
  });
  assert.deepEqual(phrasebooks.es, {
    WHO: ["TU CUÑADO", "NADIE", "EL DE ARRIBA"],
    WHERE: [],
    WHEN: ["MAÑANA"],
    WHY_HOW: [],
    WHAT: [],
  });
});

test("a phrasebook with a topic that doesn't exist, or a phrase before any topic, stops the start-up", async () => {
  await assert.rejects(loadFrom({ "phrasebook-en.txt": "# WHOM\nNobody\n" }), /"WHOM" is not a topic/);
  await assert.rejects(loadFrom({ "phrasebook-en.txt": "Nobody\n# WHO\n" }), /"Nobody" comes before any/);
});

test("there is a word list for each language, with the spirit's extra words and none of the spot answers", async () => {
  const { words } = await loadLibrary();
  assert.deepEqual(Object.keys(words), LANGUAGES);
  for (const lang of LANGUAGES) {
    assert.deepEqual(words[lang].slice(0, EXTRA_WORDS[lang].length), EXTRA_WORDS[lang]);
    assert.ok(words[lang].length > 7000, lang);
    for (const word of SPOT_ANSWERS) assert.ok(!words[lang].includes(word), `${lang}: ${word}`);
    // Single words of the board's alphabet: none can clash with NONE, which has spaces
    for (const word of words[lang]) assert.match(word, /^[A-ZÑ0-9]+$/, lang);
  }
});

test("there is a phrasebook for each language with phrases on every topic, all of them short and none reserved", async () => {
  const { phrasebooks } = await loadLibrary();
  assert.deepEqual(Object.keys(phrasebooks), LANGUAGES);
  const reserved = new Set([...SPOT_ANSWERS, NONE]);
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(phrasebooks[lang]), TOPICS);
    for (const topic of TOPICS) {
      assert.ok(phrasebooks[lang][topic].length >= 30, `${lang} ${topic}`);
      for (const phrase of phrasebooks[lang][topic]) {
        assert.ok(phrase && phrase.length <= MAX_PHRASE_LENGTH, `${lang} ${topic}: ${phrase}`);
        assert.ok(!reserved.has(phrase), `${lang} ${topic}: ${phrase}`);
      }
    }
  }
});

test("neither the word lists nor the phrasebooks spell any of the words the word-list builder blocks", async () => {
  const { words, phrasebooks } = await loadLibrary();
  for (const lang of LANGUAGES) {
    const blocked = isBlocked(lang);
    const phraseWords = Object.values(phrasebooks[lang]).flatMap((phrases) => phrases.flatMap((p) => p.split(" ")));
    for (const word of [...words[lang], ...phraseWords]) assert.ok(!blocked(word), lang);
  }
});
