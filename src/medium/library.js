// What Jev reads when it answers on its own, loaded from data/: a word list and a phrasebook per language.
import { readFile } from "node:fs/promises";

import { toBoardText } from "../text.js";
import { EXTRA_WORDS, LANGUAGES, SPOT_ANSWERS, TOPICS } from "../vocabulary.js";

const DATA_DIR = new URL("../../data/", import.meta.url);

/**
 * @typedef {Readonly<Record<string, readonly string[]>>} Phrasebook the phrases of each topic (TOPICS), as board text
 *
 * @typedef {object} Library the word list and the phrasebook of each language (LANGUAGES)
 * @property {Readonly<Record<string, readonly string[]>>} words the word lists, most frequent first
 * @property {Readonly<Record<string, Phrasebook>>} phrasebooks
 */

const readLines = async (path) => (await readFile(path, "utf8")).split(/\r?\n/).map((line) => line.trim());

/**
 * Loads a word list (one word per line, most frequent first) with `extraWords` in front, no repeats and none of
 * the words that have a spot on the board.
 *
 * @param {URL} path
 * @param {readonly string[]} extraWords
 * @returns {Promise<readonly string[]>}
 */
async function loadWordList(path, extraWords) {
  const spots = new Set(SPOT_ANSWERS);
  const words = new Set([...extraWords, ...(await readLines(path))]);
  return Object.freeze([...words].filter((word) => word && !spots.has(word)));
}

/**
 * Loads a phrasebook: phrases written the way they are said ("Tu cuñado"), one per line, each under a `# TOPIC`
 * header (one of TOPICS). They come out as board text (TU CUÑADO), by topic, in order and without repeats. It's
 * written by hand, so a mistake in it stops the server instead of going unnoticed.
 *
 * @param {URL} path
 * @returns {Promise<Phrasebook>}
 */
async function loadPhrasebook(path) {
  const book = Object.fromEntries(TOPICS.map((topic) => [topic, new Set()]));
  let topic = null;
  for (const line of await readLines(path)) {
    if (line.startsWith("#")) {
      topic = line.slice(1).trim();
      if (!Object.hasOwn(book, topic)) throw new Error(`${path}: "${topic}" is not a topic (${TOPICS.join(", ")})`);
    } else if (line) {
      if (!topic) throw new Error(`${path}: "${line}" comes before any "# TOPIC" header`);
      book[topic].add(toBoardText(line));
    }
  }
  return Object.freeze(Object.fromEntries(TOPICS.map((name) => [name, Object.freeze([...book[name]])])));
}

/** Loads one file per language, `<name>-<lang>.txt`, with `load`. */
async function perLanguage(dir, name, load) {
  const loaded = await Promise.all(LANGUAGES.map((lang) => load(new URL(`${name}-${lang}.txt`, dir), lang)));
  return Object.freeze(Object.fromEntries(LANGUAGES.map((lang, i) => [lang, loaded[i]])));
}

/**
 * The word lists (`words-es.txt`…), with the extra words the spirit needs, and the phrasebooks
 * (`phrasebook-es.txt`…).
 *
 * @param {URL} [dir]
 * @returns {Promise<Library>}
 */
export async function loadLibrary(dir = DATA_DIR) {
  const [words, phrasebooks] = await Promise.all([
    perLanguage(dir, "words", (path, lang) => loadWordList(path, EXTRA_WORDS[lang])),
    perLanguage(dir, "phrasebook", loadPhrasebook),
  ]);
  return Object.freeze({ words, phrasebooks });
}
