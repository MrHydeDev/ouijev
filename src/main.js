// Server start-up: reads the configuration, sets up Jev and the scribe, and opens the board.
import { fileURLToPath } from "node:url";

import { readConfigOrExit } from "./config.js";
import { createLogger } from "./log.js";
import { createDemoMedium } from "./medium/demo.js";
import { createJev } from "./medium/jev.js";
import { loadLibrary } from "./medium/library.js";
import { createMedium } from "./medium/medium.js";
import { createScribe } from "./scribe/scribe.js";
import { createApp, isLoopback } from "./server/app.js";

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

/** `host` as it goes in a URL: IPv6 addresses in brackets. */
const urlHost = (host) => (host.includes(":") ? `[${host}]` : host);

async function main() {
  const config = readConfigOrExit(ENV_FILE);
  const log = createLogger(config.logLevel);

  const jev = config.jev ? createJev({ apiKey: config.jev.apiKey, log, logLevel: config.logLevel }) : null;
  const scribe = config.scribe ? createScribe(config.scribe) : null;
  const medium = jev
    ? createMedium({
        jev,
        scribe,
        library: await loadLibrary(),
        log,
      })
    : createDemoMedium();

  const server = createApp({
    medium,
    status: { mode: jev ? "live" : "demo" },
    publicDir: PUBLIC_DIR,
    loopbackOnly: isLoopback(config.host),
    log,
  });

  server.on("error", (err) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `✖ Port ${config.port} is already in use: try another one with PORT=…`
        : `✖ ${err.message}`,
    );
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    log.info(`☾ Ouijev listening on http://${urlHost(config.host)}:${server.address().port}`);
    log.info(`  Jev:     ${jev ? jev.defaultModel : "demo mode (TYPESAFE_API_KEY is missing)"}`);
    log.info(
      `  Scribe:  ${scribe?.label ?? (jev ? "none, Jev answers on its own from its phrasebooks and word lists (LLM_PROVIDER)" : "-")}`,
    );
    if (!isLoopback(config.host)) {
      log.warn("⚠ Listening beyond localhost: anyone who reaches this port spends your API keys.");
    }
  });

  const shutdown = () => {
    log.info("\n☾ Closing the seance…");
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

await main();
