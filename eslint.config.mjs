// ESLint 9 flat config from eslint-config-next 16.4 (tech-reference 1.1). `next lint` no longer exists: run `npm run lint`.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow intentionally unused arguments and variables when prefixed with an underscore.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Playwright fixtures call `use(...)` and Vitest helpers such as useTestDb() register hooks; neither is a React hook.
    files: ["e2e/**/*.ts", "tests/**/*.ts", "src/**/*.test.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  globalIgnores([
    ".next/**",
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
    ".cache/**",
    "drizzle/**",
    "test-results/**",
    "playwright-report/**",
    "node_modules/**",
  ]),
]);
