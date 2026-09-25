// public/js/language.js is a classic script for the page's <head>: it runs here in a context of its own, with the
// few browser objects it touches.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const SCRIPT = await readFile(new URL("../public/js/language.js", import.meta.url), "utf8");
const STORAGE_KEY = "ouijev-language";

/** Runs the script on a page at `search` (with `stored` remembered): the language, what's stored, the new address. */
function pick({ search = "", stored, storageBlocked = false }) {
  const storage = new Map(stored ? [[STORAGE_KEY, stored]] : []);
  const addresses = [];
  const context = {
    URLSearchParams,
    location: { search, pathname: "/", hash: "#top" },
    history: { state: null, replaceState: (_state, _title, url) => addresses.push(url) },
    document: { documentElement: { lang: "" } },
    get localStorage() {
      if (storageBlocked) throw new Error("SecurityError");
      return { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    },
  };
  runInNewContext(SCRIPT, context);
  return { lang: context.document.documentElement.lang, stored: storage.get(STORAGE_KEY), address: addresses[0] };
}

test("English unless a language was chosen, and the stored choice otherwise", () => {
  assert.deepEqual(pick({}), { lang: "en", stored: undefined, address: undefined });
  assert.equal(pick({ stored: "es" }).lang, "es");
  assert.equal(pick({ stored: "klingon" }).lang, "en");
});

test("?lang= wins over the stored choice, is remembered, and goes from the address without touching the rest", () => {
  assert.deepEqual(pick({ search: "?lang=es", stored: "en" }), { lang: "es", stored: "es", address: "/#top" });
  assert.equal(pick({ search: "?debug&lang=en" }).address, "/?debug#top");
  // Not a language of the page: ignored, and left where it is
  assert.deepEqual(pick({ search: "?lang=fr", stored: "es" }), { lang: "es", stored: "es", address: undefined });
});

test("with the storage blocked, a chosen language still applies", () => {
  assert.equal(pick({ search: "?lang=es", storageBlocked: true }).lang, "es");
  assert.equal(pick({ storageBlocked: true }).lang, "en");
});
