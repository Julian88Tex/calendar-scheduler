// Lets dev scripts (seed and friends) import server modules outside Next.js. Next resolves the "server-only" marker
// package to an empty module under its react-server condition; plain Node does not, so this hook maps it to an empty
// module for both import and require. Scripts must NOT run with --conditions=react-server: under that condition React
// has no client APIs, and Next's navigation helpers (imported by the session module) crash on load.
import { registerHooks } from "node:module";

const EMPTY = "data:text/javascript,export {};";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY, shortCircuit: true, format: "module" };
    return nextResolve(specifier, context);
  },
});
