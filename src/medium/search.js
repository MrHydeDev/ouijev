// Jev on its own, without a scribe: instead of spelling the answer letter by letter, it looks for it in what it
// has to read, the phrasebook and the word list. That's what Jev is good at: it can't write, but it recognizes
// the answer when it sees it, and it reads thousands of options at once.
import { NONE, TOPICS } from "../vocabulary.js";
import { answersQuestion, batchQuestion, bestQuestion } from "./questions.js";

/** A `choice` takes at most 255 options: 249, NONE and some margin. */
const BATCH_SIZE = 249;
/** Batches per request: many more and the request goes over Jev's token limit. */
const BATCHES_PER_REQUEST = 15;
/** The most frequent words, read first: the rest of the list only if none of them answers. */
const FREQUENT_WORDS = 2000;
/** Numbers the spirit can answer with, which the word lists don't have: small ones and years. */
const NUMBERS = Object.freeze([
  ...Array.from({ length: 121 }, (_, n) => String(n)),
  ...Array.from({ length: 131 }, (_, i) => String(1900 + i)),
]);
/** From each batch, the options Jev gave at least MIN_VOTE of its vote, up to PER_BATCH of them. */
const PER_BATCH = 4;
const MIN_VOTE = 0.05;
/** The most voted of all of them go to the final choice. */
const MAX_FINALISTS = 12;
/** Jev's yes/no on the answer: below this, it doesn't answer the question. */
const MIN_FIT = 0.4;
/** With a dozen finalists splitting the vote, "none of them" often leads with a fifth: it only wins from here. */
const NONE_MIN_VOTE = 0.7;

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * What Jev reads for a question with a factual answer (or an open one no phrase answers): the numbers and the
 * most frequent words, then the rest.
 *
 * @param {readonly string[]} words the word list, most frequent first
 * @returns {string[][]}
 */
export function wordStages(words) {
  return [[...NUMBERS, ...words.slice(0, FREQUENT_WORDS)], words.slice(FREQUENT_WORDS)];
}

/**
 * What Jev reads for an open question: the phrases on its topic, then the rest of the phrasebook.
 *
 * @param {import("./library.js").Phrasebook} phrasebook
 * @param {string} topic one of TOPICS
 * @returns {string[][]}
 */
export function phraseStages(phrasebook, topic) {
  const onTopic = new Set(phrasebook[topic]);
  const rest = new Set(TOPICS.flatMap((other) => phrasebook[other]).filter((phrase) => !onTopic.has(phrase)));
  return [[...onTopic], [...rest]];
}

/**
 * @typedef {object} Finalist
 * @property {string} text
 * @property {number} vote its share of Jev's final choice
 * @property {number} fit how likely it is that it answers the question (Jev's yes/no on it)
 */

/**
 * @typedef {object} SearchResult
 * @property {string | null} answer `null` when nothing Jev read answers
 * @property {number} read how many options Jev read
 * @property {Finalist[]} finalists those of the last final choice, the most voted first
 */

/**
 * Stage by stage: Jev reads the stage in batches (many batches per request, the requests at once), and what it
 * voted for in each batch goes to a final choice, along with a yes/no on each finalist. The answer is the most
 * voted one Jev says answers the question; the next stage is only read if there is none.
 *
 * @param {object} options
 * @param {readonly (readonly string[])[]} options.stages what to read, in order, with no repeats within a stage
 * @param {(questions: Record<string, object>) => Promise<Record<string, any>>} options.decide asks Jev about the question
 * @returns {Promise<SearchResult>}
 */
export async function findAnswer({ stages, decide }) {
  let read = 0;
  let finalists = [];
  for (const stage of stages) {
    read += stage.length;
    const choice = await choose(await readBatches(stage, decide), decide);
    if (choice.finalists.length > 0) finalists = choice.finalists;
    if (choice.answer) return { answer: choice.answer, read, finalists };
  }
  return { answer: null, read, finalists };
}

/** The most voted options of every batch, the most voted first. */
async function readBatches(options, decide) {
  const requests = chunks(chunks(options, BATCH_SIZE), BATCHES_PER_REQUEST);
  const answers = await Promise.all(
    requests.map((batches) => decide(Object.fromEntries(batches.map((batch, i) => [`b${i}`, batchQuestion(batch)])))),
  );
  return answers
    .flatMap((batches) => Object.values(batches))
    .flatMap(({ probabilities }) =>
      Object.entries(probabilities)
        .filter(([text, vote]) => text !== NONE && vote >= MIN_VOTE)
        .sort((a, b) => b[1] - a[1])
        .slice(0, PER_BATCH),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FINALISTS)
    .map(([text]) => text);
}

/** In one request, the final choice among the finalists and a yes/no on each one (f0, f1…). */
async function choose(texts, decide) {
  if (texts.length === 0) return { answer: null, finalists: [] };
  const answers = await decide({
    ...Object.fromEntries(texts.map((text, i) => [`f${i}`, answersQuestion(text)])),
    best: bestQuestion(texts),
  });
  const { probabilities } = answers.best;
  const finalists = texts
    .map((text, i) => ({ text, vote: probabilities[text] ?? 0, fit: answers[`f${i}`].noul }))
    .sort((a, b) => b.vote - a.vote);
  const answer = (probabilities[NONE] ?? 0) >= NONE_MIN_VOTE ? null : finalists.find(({ fit }) => fit >= MIN_FIT);
  return { answer: answer?.text ?? null, finalists };
}
