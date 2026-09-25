import { describeError, silentLogger } from "../log.js";
import { LANGUAGES, NONE, SPIRIT, UNKNOWN_TEXT } from "../vocabulary.js";
import { SeanceError, toSeanceError } from "./errors.js";
import { answerQuestion, kindQuestion, languageQuestion, openQuestion, topicQuestion, WORDS } from "./questions.js";
import { findAnswer, phraseStages, wordStages } from "./search.js";

/**
 * Events a seance produces:
 * - `{ type: "word", word }`: an answer with its own board spot (YES, NO, GOODBYE).
 * - `{ type: "letters", text }`: letters for the planchette to point at (spaces send it back to the center).
 *
 * @typedef {{ type: "word", word: string } | { type: "letters", text: string }} SeanceEvent
 */

/**
 * `lang` is the interface's language. The answer follows the question's instead, so only the demo, which can't
 * tell, uses it.
 *
 * @typedef {object} Medium
 * @property {(question: string, options?: { signal?: AbortSignal, lang?: string }) => AsyncGenerator<SeanceEvent>} consult
 */

/** How long a seance has to answer a question, retries included. */
export const SEANCE_TIMEOUT_MS = 60_000;

/** With many candidates splitting the vote, "none of these" often wins with 20%: it only counts from here. */
const NONE_MIN_CONFIDENCE = 0.5;
/** From here on, Jev takes the question for an open one, and looks for its answer in the phrasebook first. */
const OPEN_MIN_CONFIDENCE = 0.5;

const percent = (n) => `${Math.round(n * 100)}%`;
const isOpen = (open) => open.noul >= OPEN_MIN_CONFIDENCE;

/** The language of what Jev reads on its own: the question's, if Jev has it, and English otherwise. */
function libraryLanguage(language) {
  const lang = language.toLowerCase();
  return LANGUAGES.includes(lang) ? lang : "en";
}

/** For an answer in words, the console says whether the question is open (and what about) or factual. */
function describeRoute({ kind, open, topic }) {
  if (kind.choice !== WORDS) return "";
  return isOpen(open) ? ` · open (${percent(open.noul)}), ${topic.choice}` : ` · factual (${percent(1 - open.noul)})`;
}

/**
 * The medium: orchestrates Jev's decisions to answer a question, in the language it was asked in.
 *
 * 1. Jev decides whether the answer goes to a board spot (YES, NO, GOODBYE) or needs words, what language the
 *    question is in, and whether it's an open question (no factual answer) and what about.
 * 2. If it needs words and there is a scribe, the scribe (an LLM) has been proposing candidates in parallel,
 *    in the question's language, and Jev picks one, or none.
 * 3. With no scribe, or if it fails, Jev reads in the question's language (Spanish or English; any other
 *    language gets English): an open question's answer in the phrasebook, on its topic first, and any other in
 *    the word list, which is also where an open question ends up if no phrase answers it.
 *
 * @param {object} deps
 * @param {{ systemOne: Function }} deps.jev TypeSafe client (or a test double)
 * @param {import("../scribe/scribe.js").Scribe | null} [deps.scribe]
 * @param {import("./library.js").Library} deps.library what Jev reads on its own
 * @param {import("../log.js").Logger} [deps.log]
 * @param {number} [deps.timeoutMs] time limit to answer a whole question, retries included
 * @returns {Medium}
 */
export function createMedium({ jev, scribe = null, library, log = silentLogger, timeoutMs = SEANCE_TIMEOUT_MS }) {
  const decider = (question, signal) => async (questions) => {
    const { answers } = await jev.systemOne({ state: { question, spirit: SPIRIT }, questions }, { signal });
    return answers;
  };

  async function chooseAnswer(decide, { candidates, unknown }) {
    const { answer } = await decide({ answer: answerQuestion(candidates) });
    const ranking = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    log.info(`  ${scribe.label} proposes, Jev picks: ${ranking.map(([c, p]) => `${c} ${percent(p)}`).join(" · ")}`);
    // Unless Jev is sure none works, it answers with its favorite candidate
    const [[best, confidence], [runnerUp] = []] = ranking;
    if (best !== NONE) return best;
    return confidence < NONE_MIN_CONFIDENCE && runnerUp ? runnerUp : unknown;
  }

  async function lookUp(decide, stages, what) {
    const { answer, read, finalists } = await findAnswer({ stages, decide });
    const votes = finalists.slice(0, 5).map(({ text, vote }) => `${text} ${percent(vote)}`);
    log.info(`  Jev read ${read.toLocaleString("en")} ${what}; finalists: ${votes.join(" · ") || "none"}`);
    return answer;
  }

  /** Jev on its own: an open question in the phrasebook first, and anything left in the word list. */
  async function search(decide, { language, open, topic }) {
    const lang = libraryLanguage(language.choice);
    const fromPhrasebook = isOpen(open)
      ? await lookUp(decide, phraseStages(library.phrasebooks[lang], topic.choice), "phrases")
      : null;
    return fromPhrasebook ?? (await lookUp(decide, wordStages(library.words[lang]), "words"));
  }

  /**
   * Asks the scribe for candidates without letting a failure kill the seance: it settles with the reason instead.
   *
   * @returns {Promise<{ candidates: string[], unknown?: string, error?: unknown }>}
   */
  function proposeCandidates(question, signal) {
    return scribe.propose(question, { signal }).then(
      (proposal) => proposal,
      (error) => ({ candidates: [], error }),
    );
  }

  async function* seance(question, signal) {
    const decide = decider(question, signal);
    // The scribe works on candidates while Jev decides whether words are needed
    const proposal = scribe ? proposeCandidates(question, signal) : null;

    const first = await decide({
      kind: kindQuestion,
      language: languageQuestion,
      open: openQuestion,
      topic: topicQuestion,
    });
    const { kind, language } = first;
    log.info(
      `\n"${question}" → ${kind.choice} (${percent(kind.confidence)}) · ${language.choice}${describeRoute(first)}`,
    );
    if (kind.choice !== WORDS) {
      yield { type: "word", word: kind.choice };
      return;
    }

    // Only the scribe can say "I don't know" in a language Jev can't read on its own
    const fallback = UNKNOWN_TEXT[libraryLanguage(language.choice)];
    if (proposal) {
      const { candidates, unknown, error } = await proposal;
      if (candidates.length > 0) {
        const text = await chooseAnswer(decide, { candidates, unknown: unknown ?? fallback });
        yield { type: "letters", text };
        return;
      }
      if (!signal.aborted) {
        const reason = error ? describeError(error) : "none usable";
        log.warn(`  No candidates from ${scribe.label} (${reason}); Jev will answer on its own.`);
      }
    }
    yield { type: "letters", text: (await search(decide, first)) ?? fallback };
  }

  return {
    async *consult(question, { signal = new AbortController().signal } = {}) {
      const deadline = AbortSignal.timeout(timeoutMs);
      // Whatever is still in flight when the seance settles (the scribe once it isn't needed, a request running
      // in parallel with one that failed) is canceled, so it doesn't burn tokens
      const settled = new AbortController();
      try {
        yield* seance(question, AbortSignal.any([signal, deadline, settled.signal]));
      } catch (err) {
        if (signal.aborted) return;
        if (deadline.aborted) {
          // The log shows the cause, and the SDK's ("Request was aborted.") doesn't say it was this deadline
          throw new SeanceError("seance_timeout", "The spirit takes too long to answer.", {
            status: 504,
            cause: new Error(`The seance ran past its ${timeoutMs} ms time limit`, { cause: err }),
          });
        }
        throw toSeanceError(err);
      } finally {
        settled.abort();
      }
    },
  };
}
