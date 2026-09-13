import { defineConfig, globalIgnores } from "eslint/config"
import js from "@eslint/js"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import tseslint from "typescript-eslint"
import globals from "globals"

// One lint surface for the whole workspace:
// - apps/web uses the blessed eslint-config-next (core-web-vitals + typescript),
//   pointed at the app directory because linting runs from the monorepo root.
// - apps/worker and packages/* use @eslint/js + typescript-eslint recommended.
// - root-level config files and scripts get the same non-next rules with Node
//   globals.
const scope = (files, configs, extra = {}) =>
  configs.map((entry) => ({
    ...entry,
    files,
    ...extra,
    languageOptions: { ...entry.languageOptions, ...extra.languageOptions },
    settings: { ...entry.settings, ...extra.settings },
  }))

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/out/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "apps/web/next-env.d.ts",
  ]),
  scope(["*.mjs", "scripts/**/*.mjs"], [js.configs.recommended], {
    languageOptions: { globals: globals.node },
  }),
  scope(["apps/web/**/*.{js,mjs,ts,tsx}"], [...nextVitals, ...nextTs], {
    settings: { next: { rootDir: "apps/web" } },
  }),
  scope(
    ["*.ts", "apps/worker/**/*.ts", "packages/**/*.ts", "e2e/**/*.ts"],
    [js.configs.recommended, ...tseslint.configs.recommended],
    { languageOptions: { globals: globals.node } },
  ),
  // Drizzle's pgTable extra-config callback receives the inferred table even
  // when a constraint references columns by SQL name only; `_`-prefixed
  // parameters document intent without tripping no-unused-vars.
  {
    files: ["packages/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
])
