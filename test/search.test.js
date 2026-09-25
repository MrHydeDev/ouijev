import assert from "node:assert/strict";
import { test } from "node:test";

import { findAnswer, phraseStages, wordStages } from "../src/medium/search.js";
import { NONE, TOPICS } from "../src/vocabulary.js";
import { fakeJev, noul, ranking, searchScript } from "./helpers.js";

/** A word list of `n` made-up words, most frequent first. */
const wordList = (n) => Array.from({ length: n }, (_, i) => `W${i}`);

const search = (stages, script) => {
  const jev = fakeJev(script);
  const decide = async (questions) => (await jev.systemOne({ state: {}, questions })).answers;
  return { jev, result: findAnswer({ stages, decide }) };
};

/**
 * Jev voting as told: `batchVotes(options)` in each batch it reads, `bestVotes(finalists)` in the final choice,
 * and `fits[text]` as its yes/no on each finalist.
 */
const votingJev =
  ({ batchVotes, bestVotes, fits = {} }) =>
  (request) => {
    const finalists = Object.keys(request.questions.best?.criteria ?? {}).filter((option) => option !== NONE);
    const answer = (name, question) => {
      if (question.type === "noul") return noul(fits[finalists[Number(name.slice(1))]] ?? 0);
      return ranking(name === "best" ? bestVotes(finalists) : batchVotes(Object.keys(question.criteria)));
    };
    return Object.fromEntries(Object.entries(request.questions).map(([name, q]) => [name, answer(name, q)]));
  };

/** Jev reading one stage: in each batch it votes `votes` for the first options, and then it chooses none. */
const readOnce = (votes) => {
  const batchVotes = (options) => ({ ...Object.fromEntries(votes.map((vote, i) => [options[i], vote])), [NONE]: 0.1 });
  return Array(2).fill(votingJev({ batchVotes, bestVotes: () => ({ [NONE]: 1 }) }));
};

/** What the final choice offered, without NONE. */
const offered = (jev) =>
  Object.keys(jev.requests.find(({ questions }) => "best" in questions).questions.best.criteria).filter(
    (option) => option !== NONE,
  );

test("a word list is read in two stages: the numbers and the 2,000 most frequent words, then the rest", () => {
  const [first, rest] = wordStages(wordList(5000));
  assert.equal(first.length, 252 + 2000);
  assert.deepEqual([first[0], first[120], first[121], first[251], first[252]], ["0", "120", "1900", "2030", "W0"]);
  assert.deepEqual(rest, wordList(5000).slice(2000));
});

test("a phrasebook is read on the question's topic first, then the rest, without reading anything twice", () => {
  const phrasebook = { ...Object.fromEntries(TOPICS.map((topic) => [topic, []])), WHO: ["NOBODY", "ME"] };
  Object.assign(phrasebook, { WHERE: ["HERE", "NOBODY"], WHAT: ["HERE", "DUST"] });
  assert.deepEqual(phraseStages(phrasebook, "WHO"), [
    ["NOBODY", "ME"],
    ["HERE", "DUST"],
  ]);
});

test("a frequent word is found in the first stage: one reading request and one final choice", async () => {
  const { jev, result } = search(wordStages(wordList(5000)), searchScript("W42"));
  const { answer, read, finalists } = await result;
  assert.equal(answer, "W42");
  assert.equal(read, 252 + 2000);
  assert.deepEqual(finalists, [{ text: "W42", vote: 0.9, fit: 0.9 }]);
  assert.equal(jev.requests.length, 2);
});

test("the options go in batches of at most 250, and at most 15 batches per request", async () => {
  const { jev, result } = search(wordStages(wordList(9000)), searchScript("W7000"));
  await result;
  const reading = jev.requests.filter((request) => !("best" in request.questions));
  for (const { questions } of reading) {
    assert.ok(Object.keys(questions).length <= 15);
    for (const question of Object.values(questions)) {
      assert.ok(Object.keys(question.criteria).length <= 250);
      assert.ok(Object.hasOwn(question.criteria, NONE));
    }
  }
  // Stage 1 (2,252 options) fits one request; stage 2 (7,000 words) needs two
  assert.equal(reading.length, 3);
});

test("a rarer word needs the second stage, which only runs when nothing in the first answers", async () => {
  const { result } = search(wordStages(wordList(9000)), searchScript("W5000"));
  const { answer, read } = await result;
  assert.equal(answer, "W5000");
  assert.equal(read, 252 + 9000);
});

test("numbers and years are among the options, although the word lists have none", async () => {
  for (const number of ["8", "120", "1969"]) {
    const { result } = search(wordStages(wordList(100)), searchScript(number));
    assert.equal((await result).answer, number);
  }
});

test("from each batch, up to four options with 5% of the vote or more go to the final choice", async () => {
  const offeredAfter = async (votes) => {
    const { jev, result } = search([wordList(10)], readOnce(votes));
    await result;
    return offered(jev);
  };
  assert.deepEqual(await offeredAfter([0.3, 0.2, 0.15, 0.1, 0.06]), ["W0", "W1", "W2", "W3"]);
  assert.deepEqual(await offeredAfter([0.5, 0.05]), ["W0", "W1"]);
  assert.deepEqual(await offeredAfter([0.5, 0.04]), ["W0"]);
});

test("the final choice gets the twelve most voted of all the batches, the most voted first", async () => {
  const { jev, result } = search([wordList(5 * 249)], readOnce([0.3, 0.2, 0.15, 0.1]));
  await result;
  // Five batches: their 0.3s, their 0.2s and the first two 0.15s
  const firsts = [0, 249, 498, 747, 996];
  assert.deepEqual(offered(jev), [
    ...firsts.map((i) => `W${i}`),
    ...firsts.map((i) => `W${i + 1}`),
    ...firsts.slice(0, 2).map((i) => `W${i + 2}`),
  ]);
});

test("the answer is the one most voted in the final choice, among those Jev says answer the question", async () => {
  const answerWith = (fits) => {
    const jev = votingJev({
      // The batch prefers NEVER, but the final choice, with the finalists side by side, SOON
      batchVotes: () => ({ NEVER: 0.5, SOON: 0.3, [NONE]: 0.2 }),
      bestVotes: () => ({ SOON: 0.5, NEVER: 0.3, [NONE]: 0.2 }),
      fits,
    });
    return search([["SOON", "NEVER", "LATER"]], [jev, jev]).result;
  };
  assert.equal((await answerWith({ SOON: 0.9, NEVER: 0.9 })).answer, "SOON");
  // From a 40% yes on, it answers
  assert.equal((await answerWith({ SOON: 0.4, NEVER: 0.9 })).answer, "SOON");
  assert.equal((await answerWith({ SOON: 0.39, NEVER: 0.9 })).answer, "NEVER");
  assert.deepEqual(await answerWith({ SOON: 0.2, NEVER: 0.8 }), {
    answer: "NEVER",
    read: 3,
    finalists: [
      { text: "SOON", vote: 0.5, fit: 0.2 },
      { text: "NEVER", vote: 0.3, fit: 0.8 },
    ],
  });
});

test('"none of them" only wins the final choice with 70% of the vote, and then the next stage is read', async () => {
  const run = async (none) => {
    // How much each stage's final choice leans towards none of them
    const leaning = { SOON: none, DUST: 0.1 };
    const jev = votingJev({
      batchVotes: (options) => (options.includes("DUST") ? { DUST: 0.9, [NONE]: 0.1 } : { SOON: 0.8, [NONE]: 0.2 }),
      bestVotes: ([finalist]) => ({ [finalist]: 1 - leaning[finalist], [NONE]: leaning[finalist] }),
      fits: { SOON: 0.9, DUST: 0.9 },
    });
    return (await search([["SOON"], ["DUST"]], Array(4).fill(jev)).result).answer;
  };
  assert.equal(await run(0.69), "SOON");
  assert.equal(await run(0.7), "DUST");
});

test("no answer when nothing turns up, or Jev says no finalist answers; empty stages aren't read", async () => {
  const nothing = search(wordStages(wordList(100)), searchScript("ABSENT"));
  assert.deepEqual(await nothing.result, { answer: null, read: 252 + 100, finalists: [] });
  assert.equal(nothing.jev.requests.length, 1);
  const rejected = search(wordStages(wordList(3000)), searchScript("W10", 0.2));
  const { answer, finalists } = await rejected.result;
  assert.equal(answer, null);
  // The second stage has nothing to choose from: the finalists are the first stage's
  assert.deepEqual(finalists, [{ text: "W10", vote: 0.9, fit: 0.2 }]);
});
