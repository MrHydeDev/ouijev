const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Deep-merges objects: arrays and plain values are replaced, and a `null` deletes the key. Used to combine
 * the provider's parameters, the model tuning and LLM_EXTRA_BODY (which can therefore remove a parameter your
 * model doesn't accept: `{"reasoning_effort": null}`).
 *
 * @param {...object} sources
 */
export function deepMerge(...sources) {
  const result = {};
  for (const source of sources.filter(isPlainObject)) {
    for (const [key, value] of Object.entries(source)) {
      if (value === null) delete result[key];
      else result[key] = isPlainObject(value) ? deepMerge(result[key], value) : value;
    }
  }
  return result;
}
