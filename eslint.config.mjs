import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  // ─── Ignore patterns ──────────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "deploy/**",
      "node_modules/**",
      "*.bak",
      "*.txt",
      "*.json",
      "*.xml",
      "eslint-output.txt",
    ],
  },

  // ─── Server-side JS (Node) ────────────────────────────────────────────
  {
    files: ["**/*.js", "**/*.mjs"],
    ignores: ["tests/**", "msalConfig.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",        // server.js monolith has cross-scope refs; tighten after Phase 4
      "no-console": "off",
      "eqeqeq": ["warn", "always"],
      "no-constant-condition": "warn",
      "no-debugger": "error",
      "no-empty": "warn",
      "no-extra-semi": "warn",
      "no-unreachable": "warn",
      "no-misleading-character-class": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
    },
  },

  // ─── Browser JS (msalConfig loaded in index.html <script>) ────────────
  {
    files: ["msalConfig.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
      "no-console": "off",
      "no-empty": "warn",
    },
  },

  // ─── Test files (vitest) ──────────────────────────────────────────────
  {
    files: ["tests/**/*.mjs", "tests/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
        // vitest globals
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-console": "off",
      "no-empty": "warn",
    },
  },

  // ─── CJS scripts — some run in Node, some in the browser ─────────────
  {
    files: ["**/*.cjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
      "no-console": "off",
      "eqeqeq": ["warn", "always"],
      "no-constant-condition": "warn",
      "no-debugger": "error",
      "no-empty": "warn",
      "no-extra-semi": "warn",
      "no-unreachable": "warn",
    },
  },

  // ─── Frontend JSX files (React 19) ────────────────────────────────────
  {
    files: ["**/*.jsx"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        React: "readonly",
      },
    },
    settings: {
      react: { version: "detect" },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
      "no-console": "off",
      "eqeqeq": ["warn", "always"],
      "no-constant-condition": "warn",
      "no-debugger": "error",
      "no-empty": "warn",
      "no-unreachable": "warn",
      "no-misleading-character-class": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-no-undef": "error",
      "react/no-direct-mutation-state": "error",
      "react-hooks/rules-of-hooks": "warn",   // monolith has non-standard patterns; tighten after Phase 3 split
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
