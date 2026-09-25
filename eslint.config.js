import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "scripts/**/*.js", "test/**/*.js", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      curly: ["error", "multi-line"],
      eqeqeq: ["error", "always"],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
    },
  },
];
