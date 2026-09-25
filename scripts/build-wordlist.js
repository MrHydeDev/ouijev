// Rebuilds data/words-es.txt and data/words-en.txt from the FrequencyWords frequency lists (OpenSubtitles
// 2018): https://github.com/hermitdave/FrequencyWords (content under CC BY-SA 4.0).
//
// Usage: node scripts/build-wordlist.js es_50k.txt en_50k.txt
import { readFile, writeFile } from "node:fs/promises";

import { toBoardText } from "../src/text.js";
import { isBlocked } from "./blocklist.js";

// Jev reads a list in two stages (src/medium/search.js): 2,000 words, then the rest
const MAX_WORDS = 8000;
// One- and two-letter words are almost all function words (DE, LA, OF, IN) that would only crowd Jev's
// batches; the few the spirit needs come as extra words (src/vocabulary.js).
const WORD = /^[A-ZÑ]{3,12}$/;

// Frequency ranks (0 = most frequent) for spotting stray English in the Spanish subtitles: a word that is also
// among the top ENGLISH_TOP English words is dropped when it's rare in Spanish (beyond RARE_IN_SPANISH), or
// when it's very common English (within VERY_COMMON_IN_ENGLISH) and merely uncommon in Spanish (beyond
// UNCOMMON_IN_SPANISH). Tuned by hand, reading what each threshold let through.
const ENGLISH_TOP = 5000;
const RARE_IN_SPANISH = 3000;
const VERY_COMMON_IN_ENGLISH = 1000;
const UNCOMMON_IN_SPANISH = 500;

const [spanishPath, englishPath] = process.argv.slice(2);
if (!spanishPath || !englishPath) {
  console.error("Usage: node scripts/build-wordlist.js <es_50k.txt> <en_50k.txt>");
  console.error("Download the lists from https://github.com/hermitdave/FrequencyWords/tree/master/content/2018");
  process.exit(1);
}

/** Each line is "word frequency"; returns the words in frequency order. */
async function readFrequencyList(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.split(" ")[0])
    .filter(Boolean);
}

/** The first MAX_WORDS words that pass the filters, as board text, most frequent first. */
function buildList(list, lang, keep = () => true) {
  const blocked = isBlocked(lang);
  const words = new Set();
  for (const [rank, raw] of list.entries()) {
    if (words.size >= MAX_WORDS) break;
    // Only words made of letters: no abbreviations ("sr.") or apostrophes ("l'amour")
    if (!/^\p{L}+$/u.test(raw)) continue;
    const word = toBoardText(raw);
    if (WORD.test(word) && !blocked(word) && keep(word, rank)) words.add(word);
  }
  return [...words];
}

async function write(lang, words) {
  const file = `data/words-${lang}.txt`;
  await writeFile(new URL(`../${file}`, import.meta.url), `${words.join("\n")}\n`);
  console.log(`${words.length} words in ${file}`);
}

const [spanish, english] = await Promise.all([readFrequencyList(spanishPath), readFrequencyList(englishPath)]);

// Subtitles carry untranslated English: drop whatever is frequent in English and rare in Spanish.
const englishRank = new Map();
for (const [rank, word] of english.slice(0, ENGLISH_TOP).entries()) {
  // Variants like "you." normalize the same as "you": the most frequent occurrence wins
  const key = toBoardText(word);
  if (!englishRank.has(key)) englishRank.set(key, rank);
}
const isStrayEnglish = (word, rank) => {
  const inEnglish = englishRank.get(word);
  return (
    inEnglish !== undefined &&
    (rank > RARE_IN_SPANISH || (inEnglish < VERY_COMMON_IN_ENGLISH && rank > UNCOMMON_IN_SPANISH))
  );
};

await write(
  "es",
  buildList(spanish, "es", (word, rank) => !isStrayEnglish(word, rank)),
);
await write("en", buildList(english, "en"));
