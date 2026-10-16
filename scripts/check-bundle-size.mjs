#!/usr/bin/env node
// GEN-07: the gzipped client JS loaded by /[handle]/[eventSlug] (the public booking page) must stay under 250KB.
//   npm run check:bundle                      reads the build in NEXT_DIST_DIR (default .next); run after next build
//   node scripts/check-bundle-size.mjs --route=/[handle]/[eventSlug] --limit-kb=250 --dist=.next
//
// Reads the build manifests (no network, no server): the route's client JS is the framework root main files
// (build-manifest rootMainFiles) plus every entry chunk of the route's segments (layouts and page) listed in the
// route's client reference manifest (entryJSFiles). Polyfills are excluded (served with nomodule to legacy browsers
// only). Each file is gzipped at level 9 and the sizes are summed.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const route = args.route || "/[handle]/[eventSlug]";
const limitKb = Number(args["limit-kb"] || 250);
const dist = path.resolve(args.dist || process.env.NEXT_DIST_DIR || ".next");

function fail(message) {
  console.error(`check-bundle-size: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(dist, "BUILD_ID"))) fail(`no build found in ${dist} (run next build first)`);

const pageKey = `${route === "/" ? "" : route}/page`;
const files = new Set();

// Framework and runtime chunks shared by every App Router page.
const perPageBuildManifest = path.join(dist, "server", "app", ...pageKey.split("/").filter(Boolean), "build-manifest.json");
const buildManifestPath = fs.existsSync(perPageBuildManifest) ? perPageBuildManifest : path.join(dist, "build-manifest.json");
const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
for (const f of buildManifest.rootMainFiles ?? []) files.add(f);

// Segment entry chunks of this route.
const clientRefPath = path.join(dist, "server", "app", `${pageKey.replace(/^\//, "")}_client-reference-manifest.js`);
const appBuildManifestPath = path.join(dist, "app-build-manifest.json"); // webpack builds
if (fs.existsSync(clientRefPath)) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(clientRefPath, "utf8"), sandbox, { filename: clientRefPath });
  const manifest = sandbox.__RSC_MANIFEST?.[pageKey];
  if (!manifest) fail(`client reference manifest for ${pageKey} not found in ${clientRefPath}`);
  for (const chunks of Object.values(manifest.entryJSFiles ?? {})) for (const f of chunks) files.add(f);
} else if (fs.existsSync(appBuildManifestPath)) {
  const appManifest = JSON.parse(fs.readFileSync(appBuildManifestPath, "utf8"));
  const chunks = appManifest.pages?.[pageKey];
  if (!chunks) fail(`${pageKey} not found in app-build-manifest.json`);
  for (const f of chunks) files.add(f);
} else {
  fail(`no manifest for ${pageKey}: is the route built? (looked for ${path.relative(process.cwd(), clientRefPath)})`);
}

let total = 0;
const rows = [];
for (const rel of files) {
  if (!rel.endsWith(".js")) continue;
  const file = path.join(dist, rel.replace(/^\/?_next\//, ""));
  if (!fs.existsSync(file)) fail(`chunk listed in the manifest is missing: ${rel}`);
  const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
  total += gz;
  rows.push([rel, gz]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [rel, gz] of rows.slice(0, 12)) console.log(`${(gz / 1024).toFixed(1).padStart(8)} KB  ${rel}`);
const totalKb = total / 1024;
console.log(`check-bundle-size: ${route} loads ${rows.length} JS file(s), ${totalKb.toFixed(1)} KB gzipped (limit ${limitKb} KB)`);
if (totalKb > limitKb) fail(`${route} exceeds the ${limitKb} KB gzipped client JS budget (GEN-07)`);
