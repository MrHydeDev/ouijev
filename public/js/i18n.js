// The interface in English and Spanish: the strings, the language they're shown in and a way to follow its
// changes. js/language.js picks the language before the first paint and leaves it in <html lang>.

/** Where the choice is remembered (js/language.js reads it too: a classic script can't import it). */
const STORAGE_KEY = "ouijev-language";

/** The strings, by language and key. */
export const STRINGS = {
  en: {
    heading: "Ouijev, a Ouija board answered by Jev",
    boardLabel: "Ouija board with a planchette",
    seanceLabel: "Seance",
    questionLabel: "Your question",
    placeholder: "Ask Jev…",
    summon: "SUMMON",
    languageLabel: "Language",
    waiting: "Jev awaits your question…",
    asked: "“{question}”",
    answering: "Jev is answering…",
    answered: "Jev answers: {answer}",
    demo: "Demo mode: no TYPESAFE_API_KEY in .env, so the answers are canned.",
    // The server's error codes
    "error.not_json": "The request has to be JSON.",
    "error.bad_request": "Invalid request.",
    "error.empty_question": "The question is empty.",
    "error.question_too_long": "The question can't be longer than {max} characters.",
    "error.forbidden": "Access denied.",
    "error.method_not_allowed": "Method not allowed.",
    "error.not_found": "Not found.",
    "error.too_many_seances": "Too many seances are open.",
    "error.jev_auth": "Jev's API key isn't valid, or has no access.",
    "error.jev_rate_limited": "Too many summonings. Wait a moment.",
    "error.jev_error": "Jev's API failed.",
    "error.jev_timeout": "Jev is taking too long to answer.",
    "error.jev_unreachable": "Couldn't reach Jev.",
    "error.seance_timeout": "The spirit is taking too long to answer.",
    "error.spirit_silent": "The spirit doesn't answer.",
    "error.internal": "Internal error.",
    // The ones the client detects itself (see api.js)
    "error.offline": "Couldn't reach the server.",
    "error.too_slow": "Jev is taking too long to answer.",
    "error.disconnected": "The connection to the server was cut off.",
    "error.garbled": "The server sent something unexpected.",
    // For a code this page doesn't know (a newer server's, say)
    "error.unknown": "Something went wrong.",
  },
  es: {
    heading: "Ouijev, una ouija que contesta Jev",
    boardLabel: "Tablero de ouija con una plancheta",
    seanceLabel: "Sesión",
    questionLabel: "Tu pregunta",
    placeholder: "Pregunta a Jev…",
    summon: "INVOCAR",
    languageLabel: "Idioma",
    waiting: "Jev aguarda tu pregunta…",
    asked: "«{question}»",
    answering: "Jev está respondiendo…",
    answered: "Jev responde: {answer}",
    demo: "Modo demo: sin TYPESAFE_API_KEY en .env, las respuestas son de pega.",
    "error.not_json": "La petición tiene que ser JSON.",
    "error.bad_request": "Petición no válida.",
    "error.empty_question": "Pregunta vacía.",
    "error.question_too_long": "La pregunta no puede pasar de {max} caracteres.",
    "error.forbidden": "Acceso denegado.",
    "error.method_not_allowed": "Método no permitido.",
    "error.not_found": "No encontrado.",
    "error.too_many_seances": "Hay demasiadas sesiones abiertas.",
    "error.jev_auth": "La API key de Jev no es válida o no tiene acceso.",
    "error.jev_rate_limited": "Demasiadas invocaciones. Espera un poco.",
    "error.jev_error": "La API de Jev ha fallado.",
    "error.jev_timeout": "Jev tarda demasiado en responder.",
    "error.jev_unreachable": "No se ha podido conectar con Jev.",
    "error.seance_timeout": "El espíritu tarda demasiado en contestar.",
    "error.spirit_silent": "El espíritu no responde.",
    "error.internal": "Error interno.",
    "error.offline": "No se ha podido contactar con el servidor.",
    "error.too_slow": "Jev tarda demasiado en responder.",
    "error.disconnected": "Se ha cortado la conexión con el servidor.",
    "error.garbled": "El servidor ha respondido algo inesperado.",
    "error.unknown": "Algo ha fallado.",
  },
};

/** @type {"en" | "es"} */
let language = document.documentElement.lang;
const listeners = [];

/** The language the interface is in. */
export const getLanguage = () => language;

/**
 * The string for `key` in the current language, with each `{name}` in it replaced by `vars.name`.
 *
 * @param {string} key
 * @param {Record<string, string>} [vars]
 */
export function t(key, vars = {}) {
  return STRINGS[language][key].replace(/\{(\w+)\}/g, (_, name) => vars[name]);
}

/**
 * The message for an error code (the server's or the client's own), or a generic one for a code it doesn't know.
 *
 * @param {string} code
 * @param {Record<string, string>} [vars] for the messages with placeholders (`max`, for the length limit)
 */
export function errorMessage(code, vars) {
  const key = `error.${code}`;
  return t(Object.hasOwn(STRINGS[language], key) ? key : "error.unknown", vars);
}

/**
 * Switches the interface to `next`: the choice is remembered and whoever follows the changes is told.
 *
 * @param {"en" | "es"} next
 */
export function setLanguage(next) {
  if (next === language) return;
  language = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be blocked: then the choice lasts as long as the page
  }
  for (const listener of listeners) listener(next);
}

/** Calls `listener` every time the language changes. */
export function onLanguageChange(listener) {
  listeners.push(listener);
}
