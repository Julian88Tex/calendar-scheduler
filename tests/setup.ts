// Vitest setup (ARCHITECTURE section 24.1): deterministic environment for every test file.
// "server-only" is aliased to an empty module in vitest.config.ts.
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV = "test";
env.TZ = "UTC";
env.APP_URL = "http://localhost:3000";
env.NEXT_PUBLIC_APP_NAME ??= "Kairos";
// Never let a developer's shell or .env point the unit tests at a real deployment.
delete env.VERCEL;
delete env.VERCEL_ENV;
delete env.VERCEL_URL;
delete env.DATABASE_URL;
delete env.POSTGRES_URL;
delete env.DATABASE_URL_UNPOOLED;
delete env.POSTGRES_URL_NON_POOLING;
delete env.PGLITE_DIR;
delete env.E2E_TEST_MODE;
delete env.E2E_SECRET;
