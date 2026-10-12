#!/usr/bin/env node
// Per-module type check (ARCHITECTURE sections 24.3 and 26 rule 18):
//
//   npm run typecheck:owned -- [--module=<module-id>] <path-prefix...>
//   e.g. npm run typecheck:owned -- --module=booking-core src/lib/booking tests/booking-core
//
// Runs `tsc --noEmit --incremental --tsBuildInfoFile .cache/tsc-<module>.tsbuildinfo` over the whole project under
// `scripts/heavy.sh tsc` (at most two type checks at once), then prints only the diagnostics whose file path starts
// with one of the given prefixes, so other modules' in-progress errors do not block you. Exits 1 only when such
// diagnostics exist (or when tsc fails without file diagnostics, for example a broken tsconfig). Runs
// `next typegen` first when the shared route types (.next/types) are missing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
let moduleId = process.env.KAIROS_MODULE || "";
const prefixes = [];
for (const a of argv) {
  if (a.startsWith("--module=")) moduleId = a.slice("--module=".length);
  else if (a === "--help" || a === "-h") {
    console.log("usage: npm run typecheck:owned -- [--module=<id>] <path-prefix...>");
    process.exit(0);
  } else prefixes.push(a);
}
if (prefixes.length === 0) {
  console.error("usage: npm run typecheck:owned -- [--module=<id>] <path-prefix...>");
  process.exit(2);
}

const normalize = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const wanted = prefixes.map(normalize);
if (!moduleId) moduleId = wanted[0].replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "owned";
const safeModule = moduleId.replace(/[^a-zA-Z0-9-]+/g, "-");

// Inner mode: we already hold a tsc slot (re-executed through scripts/heavy.sh).
if (process.env.KAIROS_TYPECHECK_INNER === "1") {
  fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
  const routesTypes = path.join(root, ".next", "types", "routes.d.ts");
  if (!fs.existsSync(routesTypes) || !fs.existsSync(path.join(root, "next-env.d.ts"))) {
    console.error("[typecheck-owned] route types missing, running next typegen ...");
    const tg = spawnSync(path.join(root, "node_modules", ".bin", "next"), ["typegen"], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, NEXT_DIST_DIR: "" },
    });
    if (tg.status !== 0) console.error("[typecheck-owned] next typegen failed; continuing");
  }
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  const res = spawnSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--pretty",
      "false",
      "--incremental",
      "--tsBuildInfoFile",
      path.join(".cache", `tsc-${safeModule}.tsbuildinfo`),
      "-p",
      "tsconfig.json",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const lines = output.split(/\r?\n/);
  const diagnostics = []; // { file, text }
  const globals = [];
  const headRe = /^(.+?)\(\d+,\d+\): (error|warning) TS\d+:/;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = headRe.exec(line);
    if (m) diagnostics.push({ file: normalize(m[1]), text: line });
    else if (/^error TS\d+:/.test(line)) globals.push(line);
    else if (diagnostics.length && /^\s/.test(line)) diagnostics[diagnostics.length - 1].text += `\n${line}`;
    else if (globals.length && /^\s/.test(line)) globals[globals.length - 1] += `\n${line}`;
  }
  const matches = diagnostics.filter((d) => wanted.some((p) => d.file.startsWith(p)));
  for (const d of matches) console.log(d.text);
  for (const g of globals) console.log(g);
  const others = diagnostics.length - matches.length;
  if (res.status !== 0 && diagnostics.length === 0 && globals.length === 0) {
    console.error(`[typecheck-owned] tsc exited with status ${res.status} without diagnostics:\n${output}`);
    process.exit(1);
  }
  console.error(
    `[typecheck-owned] module=${safeModule}: ${matches.length} diagnostic(s) in ${wanted.join(", ")}` +
      (globals.length ? `, ${globals.length} global error(s)` : "") +
      (others ? ` (${others} elsewhere ignored)` : ""),
  );
  process.exit(matches.length > 0 || globals.length > 0 ? 1 : 0);
}

// Outer mode: re-run this script under the tsc slot of scripts/heavy.sh.
const child = spawn(path.join(root, "scripts", "heavy.sh"), ["tsc", process.execPath, ...process.argv.slice(1)], {
  stdio: "inherit",
  env: { ...process.env, KAIROS_TYPECHECK_INNER: "1", KAIROS_MODULE: safeModule },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
