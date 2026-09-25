// Live reduced-motion preference: if it changes while the page is open, it applies immediately.
// It's an object (not a boolean) so that whoever receives it always reads the current value.
const query = matchMedia("(prefers-reduced-motion: reduce)");

export const motion = { reduced: query.matches };

query.addEventListener("change", (event) => {
  motion.reduced = event.matches;
});
