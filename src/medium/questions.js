// Typed questions put to Jev. Jev doesn't generate text, it only decides, so every step of a seance is one of
// these. The wording was measured against Jev on a battery of questions (see scripts/eval.js): changing it
// changes the answers.
import { choice, noul } from "@typesafe-ai/sdk";

import { BOARD_WORDS, NONE, TOPICS } from "../vocabulary.js";

/** Option of the first decision meaning "the answer needs words". */
export const WORDS = "WORDS";

const BOARD_WORD_CRITERIA = {
  YES: "It is a yes/no question and the answer is yes",
  NO: "It is a yes/no question and the answer is no",
  GOODBYE: "The person is saying goodbye or wants to end the session",
};

/** First decision: does the answer go to a board spot, or does it need words? */
export const kindQuestion = choice("A spirit answers the question through a Ouija board. How does it answer?", {
  ...Object.fromEntries(BOARD_WORDS.map((word) => [word, BOARD_WORD_CRITERIA[word]])),
  [WORDS]: "Any other answer: it needs words, spelled out on the board",
});

/** Asked along with the first decision: it picks what Jev reads, and how to say "I don't know". */
export const languageQuestion = choice("What language is the question written in?", {
  ES: "Spanish",
  EN: "English",
  LATIN: "Another language written in the Latin alphabet (French, Italian, Portuguese, German...)",
  OTHER: "A language written in another script (Cyrillic, Greek, Arabic, Chinese, Japanese...)",
});

/** Also asked along with the first decision: an open question gets its answer from the phrasebook. */
export const openQuestion = noul(
  "Is this an open question with no factual answer (about the future, fate, the unknown, feelings, or the " +
    "person asking), where the spirit would answer in a cryptic or evocative way?",
);

const TOPIC_CRITERIA = {
  WHO: "A person or a being: who",
  WHERE: "A place: where",
  WHEN: "A time or a moment: when",
  WHY_HOW: "A reason or a way: why, or how",
  WHAT: "Anything else: what happens, what there is, what to do, what someone wants",
};

/** And what the question asks about: the phrasebook section Jev reads first. */
export const topicQuestion = choice(
  "What does the question ask about?",
  Object.fromEntries(TOPICS.map((topic) => [topic, TOPIC_CRITERIA[topic]])),
);

/**
 * Pick one of the scribe's candidates, or none of them.
 *
 * @param {readonly string[]} candidates
 */
export function answerQuestion(candidates) {
  return choice(
    "A mocking, cryptic spirit answers the question through a Ouija board. Pick the answer that best answers the " +
      "question; if the question has no objective answer, pick the most evocative one. The spirit's profile only " +
      "matters if the question is about the spirit itself (its name, origin or age).",
    {
      ...Object.fromEntries(candidates.map((candidate) => [candidate, null])),
      [NONE]: "None of the other options works as an answer to this question",
    },
  );
}

/**
 * One batch of what Jev reads (phrases or words): Jev picks the one that answers, or none. At most 255 options
 * per question.
 *
 * @param {readonly string[]} options
 */
export function batchQuestion(options) {
  return choice(
    `A spirit answers the question through a Ouija board with one of these words. Pick the word that best answers the question, or ${NONE} if none of them does.`,
    { ...Object.fromEntries(options.map((option) => [option, null])), [NONE]: null },
  );
}

/**
 * Whether one finalist answers the question: a yes/no, so each is judged on its own.
 *
 * @param {string} finalist
 */
export function answersQuestion(finalist) {
  return noul(`Does "${finalist}" answer the question?`, {
    true: "It answers the question: correct if the question has a factual answer, fitting if it doesn't",
    false: "It doesn't answer the question, or it is wrong",
  });
}

/**
 * Which of the finalists is the spirit's answer, or none of them.
 *
 * @param {readonly string[]} finalists
 */
export function bestQuestion(finalists) {
  return choice("Which of these is the spirit's answer to the question?", {
    ...Object.fromEntries(finalists.map((finalist) => [finalist, null])),
    [NONE]: "None of them answers the question",
  });
}
