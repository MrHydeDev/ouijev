// The interface's strings. i18n.js reads the language from <html lang> when it loads, so a bare document stands
// in for the browser's.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

globalThis.document = { documentElement: { lang: "en" } };
const stored = new Map();
globalThis.localStorage = { setItem: (key, value) => stored.set(key, value) };
const { errorMessage, getLanguage, onLanguageChange, setLanguage, STRINGS, t } = await import("../public/js/i18n.js");

/** Every error code the server can send: the ones its HttpError and SeanceError are built with. */
async function serverErrorCodes() {
  const dir = new URL("../src/", import.meta.url);
  const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith(".js"));
  const codes = new Set();
  for (const file of files) {
    const source = await readFile(new URL(file.replaceAll("\\", "/"), dir), "utf8");
    for (const [, code] of source.matchAll(/(?:HttpError|SeanceError)\(\s*"([a-z_]+)"/g)) codes.add(code);
    for (const [, code] of source.matchAll(/\bcode: "([a-z_]+)"/g)) codes.add(code);
    for (const [, code] of source.matchAll(/\[\w+, "([a-z_]+)", \d{3},/g)) codes.add(code);
  }
  return codes;
}

test("the server's error codes all have a translation, in both languages", async () => {
  const codes = await serverErrorCodes();
  assert.ok(codes.size >= 15, `only found ${[...codes]}`);
  for (const lang of ["en", "es"]) {
    setLanguage(lang);
    for (const code of codes) assert.notEqual(errorMessage(code), errorMessage("not-a-code"), `${lang}: ${code}`);
  }
});

test("the page's own error codes (a server too slow, offline, an answer it can't read) have one too", async () => {
  const source = await readFile(new URL("../public/js/api.js", import.meta.url), "utf8");
  // Each line from its first ApiError( on: the codes are the literals it's built with
  const calls = source
    .split(/\r?\n/)
    .filter((line) => line.includes("ApiError("))
    .map((line) => line.slice(line.indexOf("ApiError(")));
  const codes = new Set(calls.flatMap((line) => [...line.matchAll(/"([a-z_]+)"/g)].map(([, code]) => code)));
  assert.deepEqual([...codes].sort(), ["disconnected", "garbled", "offline", "too_slow"]);
  for (const lang of ["en", "es"]) {
    setLanguage(lang);
    for (const code of codes) assert.notEqual(errorMessage(code), errorMessage("not-a-code"), `${lang}: ${code}`);
  }
});

test("both languages have the same strings, with the same placeholders", () => {
  const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map(([match]) => match).sort();
  assert.deepEqual(Object.keys(STRINGS.es), Object.keys(STRINGS.en));
  for (const [key, text] of Object.entries(STRINGS.en)) {
    assert.deepEqual(placeholders(STRINGS.es[key]), placeholders(text), key);
  }
  setLanguage("es");
  assert.equal(t("answered", { answer: "LUNA" }), "Jev responde: LUNA");
});

test("switching the language updates <html lang>, is remembered and tells whoever listens", () => {
  setLanguage("en");
  const heard = [];
  onLanguageChange((lang) => heard.push(lang));
  setLanguage("es");
  setLanguage("es");
  assert.equal(getLanguage(), "es");
  assert.equal(globalThis.document.documentElement.lang, "es");
  assert.equal(stored.get("ouijev-language"), "es");
  assert.deepEqual(heard, ["es"]);
});

test("the page's languages are the same in the strings, the switch and the script that picks one", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/js/language.js", import.meta.url), "utf8");
  const languages = Object.keys(STRINGS);
  assert.deepEqual(
    [...html.matchAll(/hreflang="([a-z]+)"/g)].map(([, lang]) => lang),
    languages,
  );
  assert.deepEqual(
    [...script.matchAll(/value === "([a-z]+)"/g)].map(([, lang]) => lang),
    languages,
  );
});

test("the choice is remembered under the same key the script that picks the language reads", async () => {
  const script = await readFile(new URL("../public/js/language.js", import.meta.url), "utf8");
  setLanguage("en");
  setLanguage("es");
  const [key] = [...stored.keys()];
  assert.ok(script.includes(`"${key}"`), key);
});

test("the length limit in its message is the one the page is given", () => {
  setLanguage("en");
  assert.equal(errorMessage("question_too_long", { max: "300" }), "The question can't be longer than 300 characters.");
});

test("a code the page doesn't know gets the generic message", () => {
  setLanguage("en");
  assert.equal(errorMessage("from_the_future"), "Something went wrong.");
});

test("the page's HTML comes in English with the same texts as STRINGS.en, for the first paint", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const en = STRINGS.en;
  for (const text of [en.heading, en.questionLabel, en.summon, en.waiting]) assert.ok(html.includes(`>${text}<`), text);
  for (const attribute of [
    `aria-label="${en.boardLabel}"`,
    `aria-label="${en.seanceLabel}"`,
    `aria-label="${en.languageLabel}"`,
    `placeholder="${en.placeholder}"`,
  ]) {
    assert.ok(html.includes(attribute), attribute);
  }
});
