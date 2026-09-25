import { toBoardText } from "../text.js";
import { NONE, SPIRIT, SPOT_ANSWERS, UNKNOWN_TEXT } from "../vocabulary.js";

/** What the prompt asks for: between `min` and `max` candidates of up to `letters` letters. */
const ASKED = { min: 6, max: 8, letters: 14 };
/** Some slack over what the prompt asks for: models don't always count right. */
export const MAX_CANDIDATES = ASKED.max + 2;
const MAX_CANDIDATE_LENGTH = ASKED.letters + 2;
/** Answers the board already has, or that Jev's choice offers on its own: a candidate can't be one of them. */
const RESERVED = new Set([...SPOT_ANSWERS, ...Object.values(UNKNOWN_TEXT), NONE]);

export const SYSTEM_PROMPT = `You write the answers of a Ouija board. You get the question someone asks the spirit and propose candidate answers; another model will pick one of them.

Reply with JSON only, shaped like this: {"candidates": ["...", "..."], "unknown": "..."}

Rules:
- Between ${ASKED.min} and ${ASKED.max} candidates, all different.
- Each one is ONE word, or two separated by a space (never glued together), with at most ${ASKED.letters} letters in all, in CAPITALS, without accents or punctuation. A number is fine too.
- Vary the kind of answer: if the question has a factual answer, include the correct one and a couple of plausible but wrong alternatives; always add something evasive, something cryptic and something unsettling.
- Spooky, never harmful: nothing that encourages self-harm or violence, and nothing sexual or hateful.
- Write every candidate in the language the question is written in: a question in English gets English answers, one in French gets French answers. If the question uses another script (Cyrillic, Greek, Arabic, Chinese, Japanese...), write the candidates in English, because the board only has Latin letters.
- Write it the way a careful native speaker would: natural and grammatically correct. Names stay as they are (JEV, TYPESAFE).
- Don't include "YES", "NO", "GOODBYE" or "I DON'T KNOW", nor their translations: the board has its own spots for those.
- "unknown": how the spirit says "I don't know" in that same language, in the same format.
- The spirit's profile, in case the question is about it: ${JSON.stringify(SPIRIT)}`;

const ANY_LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;
/** Whether most of the question's letters are Latin; if not, the board can't answer in its language. */
const isMostlyLatin = (text) => (text.match(LATIN_LETTER)?.length ?? 0) * 2 >= (text.match(ANY_LETTER)?.length ?? 0);

/**
 * The user message. Models don't always notice on their own that the board can't write Cyrillic or kana, so
 * the language comes spelled out.
 *
 * @param {string} question
 */
export function scribeMessage(question) {
  const language = isMostlyLatin(question)
    ? "Answer in the language the question is written in."
    : "Answer in English.";
  return `${language}\nQuestion: ${question}`;
}

/** Response schema, for the providers that support structured output. */
export const CANDIDATES_SCHEMA = Object.freeze({
  type: "object",
  properties: { candidates: { type: "array", items: { type: "string" } }, unknown: { type: "string" } },
  required: ["candidates", "unknown"],
  additionalProperties: false,
});

/** Enough for any preamble; without a cap, a flood of unbalanced braces makes the search quadratic. */
const MAX_OBJECT_STARTS = 32;

/**
 * Possible JSON inside a text: first the whole text, then, in order, the balanced `{…}` objects that start
 * at one of its first MAX_OBJECT_STARTS braces (braces inside strings are respected).
 */
function* jsonObjects(text) {
  yield text.trim();
  let start = -1;
  for (let tries = 0; tries < MAX_OBJECT_STARTS; tries++) {
    start = text.indexOf("{", start + 1);
    if (start === -1) return;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        yield text.slice(start, i + 1);
        break;
      }
    }
  }
}

function findProposal(text) {
  let sawJson = false;
  for (const chunk of jsonObjects(text)) {
    let parsed;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      continue;
    }
    sawJson = true;
    if (Array.isArray(parsed?.candidates)) return parsed;
  }
  throw new Error(sawJson ? 'the JSON has no "candidates" list' : "the response contains no valid JSON");
}

/** Board text for a candidate, or `null` if it isn't text or a finite number, or doesn't fit the board. */
function boardText(raw) {
  if (typeof raw !== "string" && !Number.isFinite(raw)) return null;
  const text = toBoardText(raw);
  return text && text.length <= MAX_CANDIDATE_LENGTH ? text : null;
}

/**
 * @typedef {object} Proposal
 * @property {string[]} candidates board text, ready for Jev to pick from
 * @property {string} [unknown] how to say "I don't know" in the question's language
 */

/**
 * Extracts the candidates from the scribe's response and gets them ready for the board. Tolerates text
 * around the JSON (code fences, preambles), because not every model obeys equally well, and drops anything
 * that isn't text or a finite number.
 *
 * @param {string} text
 * @returns {Proposal}
 * @throws {Error} if there is no JSON with the expected shape, or none of its candidates survives the cleanup
 */
export function parseProposal(text) {
  const proposal = findProposal(text);
  const candidates = new Set();
  for (const raw of proposal.candidates) {
    const candidate = boardText(raw);
    if (candidate && !RESERVED.has(candidate)) candidates.add(candidate);
    if (candidates.size === MAX_CANDIDATES) break;
  }
  if (candidates.size === 0) throw new Error('the "candidates" list has nothing usable');
  const unknown = boardText(proposal.unknown);
  return { candidates: [...candidates], ...(unknown && { unknown }) };
}
