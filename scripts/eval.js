// Asks the questions in scripts/eval/battery.js to the real medium and measures it: the answers, how many are
// right, how long they take and how many of Jev's tokens they cost. It spends real credit (TypeSafe's, and the
// scribe's), so it only runs on purpose.
//
// Usage: npm run eval -- [--no-scribe] [--only id1,id2]   (npm needs the --, or it keeps the options itself)
import { fileURLToPath } from "node:url";

import { readConfigOrExit } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { createJev } from "../src/medium/jev.js";
import { loadLibrary } from "../src/medium/library.js";
import { createMedium } from "../src/medium/medium.js";
import { createScribe } from "../src/scribe/scribe.js";
import { toBoardText } from "../src/text.js";
import { BATTERY } from "./eval/battery.js";

const args = process.argv.slice(2);
const withScribe = !args.includes("--no-scribe");
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : (args[onlyAt + 1] ?? "").split(",").filter(Boolean);
if (only?.length === 0) {
  console.error(
    "✖ --only needs the ids of the questions to ask (see scripts/eval/battery.js): --only es-capital,en-name",
  );
  process.exit(1);
}
const unknown = only?.filter((id) => !BATTERY.some((item) => item.id === id)) ?? [];
if (unknown.length > 0) {
  console.error(`✖ Not in scripts/eval/battery.js: ${unknown.join(", ")}`);
  process.exit(1);
}

const config = readConfigOrExit(fileURLToPath(new URL("../.env", import.meta.url)));
if (!config.jev) {
  console.error("✖ The eval asks the real Jev: set TYPESAFE_API_KEY.");
  process.exit(1);
}
if (withScribe && !config.scribe) {
  console.error("✖ There is no scribe (LLM_PROVIDER): configure one, or measure Jev on its own with --no-scribe.");
  process.exit(1);
}

// The same Jev, scribe and library the app uses (see src/main.js)
const log = createLogger("warn");
const client = createJev({ apiKey: config.jev.apiKey, log, logLevel: "warn" });
let tokens = 0;
/** The app's client, counting what every request costs. */
const jev = {
  async systemOne(request, options) {
    const result = await client.systemOne(request, options);
    tokens += result.usage.input_tokens + result.usage.output_tokens;
    return result;
  },
};
const medium = createMedium({
  jev,
  scribe: withScribe ? createScribe(config.scribe) : null,
  library: await loadLibrary(),
  // The warnings show when a scribe fails and Jev answers on its own instead: that isn't the scribe's score
  log,
});

const rows = [];
for (const item of BATTERY.filter(({ id }) => !only || only.includes(id))) {
  const spent = tokens;
  const started = performance.now();
  let answer = "";
  let error;
  try {
    for await (const event of medium.consult(item.q)) answer += event.type === "word" ? event.word : event.text;
  } catch (err) {
    error = err;
  }
  const row = {
    ...item,
    answer: toBoardText(answer),
    failed: Boolean(error),
    // A failure counts as a wrong answer, so it can't make the score look better
    correct: item.expect ? !error && item.expect.includes(toBoardText(answer)) : null,
    ms: Math.round(performance.now() - started),
    tokens: tokens - spent,
  };
  rows.push(row);
  const mark = error ? "!" : row.correct === null ? "·" : row.correct ? "✔" : "✖";
  const shown = error ? `${error.code ?? error.name}: ${error.cause?.message ?? error.message}` : row.answer;
  console.log(
    `${mark} ${item.id.padEnd(16)} ${shown.padEnd(28)} ${String(row.ms).padStart(6)} ms ${String(row.tokens).padStart(7)} tok`,
  );
  // A key TypeSafe turns away won't work for the next question either
  if (error?.code === "jev_auth") break;
}

const graded = rows.filter((row) => row.correct !== null);
const byType = (...types) => {
  const some = graded.filter((row) => types.includes(row.type));
  return `${some.filter((row) => row.correct).length}/${some.length}`;
};
const times = rows.map((row) => row.ms).sort((a, b) => a - b);
const quantile = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(
  `\n${withScribe ? "With the scribe" : "Jev on its own"}: ${graded.filter((row) => row.correct).length}/${graded.length} right` +
    ` (yes/no/goodbye ${byType("yesno", "goodbye")}, facts ${byType("fact")}, about the spirit ${byType("personal")})` +
    ` · ${quantile(0.5)} ms median, ${quantile(0.9)} ms p90 · ${Math.round(tokens / Math.max(1, rows.length))} Jev tokens per question`,
);
const failures = rows.filter((row) => row.failed).length;
if (failures > 0) console.log(`${failures} of ${rows.length} questions failed (marked with !), and count as wrong.`);
