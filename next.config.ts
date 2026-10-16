// Next.js 16.4 config (tech-reference 1.2, ARCHITECTURE section 23).
// Loaded through Node's native TypeScript support ("type": "module"): relative imports need the .ts extension.
import type { NextConfig } from "next";
import { nextHeaderRules } from "./src/lib/net/frame-policy.ts";

// CSRF for Server Actions (ARCHITECTURE 18.5): Next's built-in check compares Origin with the request host. Behind a
// proxy that rewrites the host, requests from the APP_URL origin must still pass, so its host is allowed explicitly
// (redundant, and harmless, when it equals the request host). Nothing else is ever allowed.
function appUrlHost(): string | null {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).host : null;
  } catch {
    return null;
  }
}
const actionOriginHost = appUrlHost();

// E2E dev servers (E2E_TEST_MODE=1) skip Turbopack's persistent dev cache: restarting `next dev` on a warm per-module
// dist dir occasionally made the first page reload itself in a loop ("Compiled in 2ms" after every request), which
// broke form tests. The price is a cold compile at the start of every e2e run.
const e2eDevServer = process.env.E2E_TEST_MODE === "1";

const nextConfig: NextConfig = {
  experimental: {
    ...(actionOriginHost ? { serverActions: { allowedOrigins: [actionOriginHost] } } : {}),
    ...(e2eDevServer ? { turbopackFileSystemCacheForDev: false } : {}),
  },
  typedRoutes: true, // stable top-level option in 16.x
  agentRules: false, // do not let `next dev` write AGENTS.md (its text also contains em dashes, GEN-11)
  // Parallel local dev and e2e runs use their own build output dirs (ARCHITECTURE section 24.2).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Load PGlite (wasm plus data files) with native require instead of bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Ship the SQL migrations with every function (runtime migrations, section 5.1). Keep this here, not in vercel.json.
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"], "/**": ["./drizzle/**/*"] },
  // getDb() never loads PGlite on Vercel (SetupRequiredError instead), so keep its wasm and data files out of every
  // function bundle there.
  outputFileTracingExcludes: process.env.VERCEL ? { "/**": ["node_modules/@electric-sql/pglite/**"] } : undefined,
  // cacheComponents: intentionally NOT enabled (tech-reference 1.3); the root layout exports dynamic = "force-dynamic".
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "graph.microsoft.com" },
    ],
  },
  // SPEC GEN-08: framing allowed only on embeddable pages (ARCHITECTURE section 4); nosniff and referrer policy on all.
  async headers() {
    return nextHeaderRules();
  },
};

export default nextConfig;
