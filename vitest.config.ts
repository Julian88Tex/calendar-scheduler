// Vitest 5 (tech-reference 12.1, ARCHITECTURE section 24.1).
//
// Two projects:
// - "default": unit and PGlite integration tests (src/**/*.test.ts, tests/**/*.test.ts), excluding *.pg.test.ts.
// - "pg": race and real Postgres tests (**/*.pg.test.ts). They are wrapped in describe.runIf(process.env.TEST_DATABASE_URL)
//   and run against embedded-postgres through `npm run test:pg` (scripts/with-embedded-pg.mjs).
import path from "node:path";
import { defineConfig } from "vitest/config";

// Pin the process time zone so Date, rrule and luxon defaults match Vercel (UTC) on every machine. Workers inherit it.
process.env.TZ = "UTC";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    tsconfigPaths: true, // Vite 8 native "@/..." alias support
    alias: {
      // "server-only" throws outside the react-server condition; tests import server modules directly.
      "server-only": path.join(root, "tests/helpers/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ["tests/setup.ts"],
    // 4 vCPU build machine shared by up to 4 agents (ARCHITECTURE section 26 rule 18).
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "default",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["**/*.pg.test.ts", "e2e/**", "node_modules/**", ".next*/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "pg",
          include: ["src/**/*.pg.test.ts", "tests/**/*.pg.test.ts"],
          exclude: ["e2e/**", "node_modules/**", ".next*/**"],
        },
      },
    ],
  },
});
