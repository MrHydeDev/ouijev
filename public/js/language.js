// Picks the interface language and sets it on <html lang>, where js/i18n.js takes it from. A classic script in
// <head>, not a module, so <html lang> is right from the first paint; an external file because the CSP is
// `script-src 'self'`. The texts themselves (English in the HTML) are translated when js/main.js runs, the same
// moment it draws the board for the first time.
//
// The browser's language isn't sniffed: the page is in English unless a language was chosen. The EN | ES links
// carry `?lang=`, an explicit choice that wins over the stored one (so opening the other language in a new tab
// shows that language) and is remembered; then the marker is removed from the address.
(() => {
  const STORAGE_KEY = "ouijev-language";
  const isLanguage = (value) => value === "en" || value === "es";
  const chosen = new URLSearchParams(location.search).get("lang");
  let stored = null;
  try {
    if (isLanguage(chosen)) localStorage.setItem(STORAGE_KEY, chosen);
    else stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked: then the choice isn't remembered
  }
  if (isLanguage(chosen)) {
    // Only the marker goes: URLSearchParams would also rewrite the rest (`?debug` as `?debug=`)
    const pairs = location.search.slice(1).split("&");
    const query = pairs.filter((pair) => !pair.startsWith("lang=")).join("&");
    history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  document.documentElement.lang = [chosen, stored].find(isLanguage) ?? "en";
})();
