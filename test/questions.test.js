import assert from "node:assert/strict";
import { test } from "node:test";

import { BOARD_WORDS, NONE, TOPICS } from "../src/vocabulary.js";
import {
  answerQuestion,
  answersQuestion,
  batchQuestion,
  bestQuestion,
  kindQuestion,
  languageQuestion,
  topicQuestion,
  WORDS,
} from "../src/medium/questions.js";

const options = (question) => Object.keys(question.criteria);

test("the first decision offers the board words and words, and the language question the four families", () => {
  assert.deepEqual(options(kindQuestion), [...BOARD_WORDS, WORDS]);
  assert.deepEqual(options(languageQuestion), ["ES", "EN", "LATIN", "OTHER"]);
});

test("along with it, the topic of an open question, one of the phrasebooks' sections", () => {
  assert.deepEqual(options(topicQuestion), TOPICS);
  assert.ok(Object.values(topicQuestion.criteria).every(Boolean));
});

test("the scribe's candidates are offered as they are, with none of them last", () => {
  assert.deepEqual(options(answerQuestion(["AZUL", "GRIS"])), ["AZUL", "GRIS", NONE]);
});

test("a batch offers its words and none of them", () => {
  const question = batchQuestion(["LUNA", "LUZ"]);
  assert.deepEqual(options(question), ["LUNA", "LUZ", NONE]);
  assert.match(question.instructions, new RegExp(NONE));
});

test("the judgment asks about each finalist on its own, and which one is the answer", () => {
  const judged = answersQuestion("LUZ");
  assert.equal(judged.type, "noul");
  assert.match(judged.instructions, /"LUZ"/);
  assert.deepEqual(options(bestQuestion(["LUNA", "LUZ"])), ["LUNA", "LUZ", NONE]);
});
