// drizzle-kit config (tech-reference 3.2). Only the foundation runs `npm run db:generate` (ARCHITECTURE 5.1);
// module agents never change src/db/** or drizzle/** and file docs/schema-requests/<module-id>.md instead.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  // Not needed for `generate`; only used by `drizzle-kit studio`/`push`, which this project does not use.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/unused" },
  strict: true,
  verbose: true,
});
