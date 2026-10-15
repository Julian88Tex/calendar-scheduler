// Static guard for postgres.js parameter safety (runs in the default suite, no database needed).
//
// Production runs drizzle-orm/postgres-js (prepare: false); the regular suite runs PGlite. They serialize parameters
// differently, so a whole class of queries passes every PGlite test and fails (or silently returns wrong rows) in
// production. postgres.js types a raw parameter itself (Date as timestamptz, boolean as bool) or asks Postgres for the
// type it infers, then runs that type's serializer, and drizzle replaces the timestamp, date, time, json and jsonb
// serializers with a pass-through:
// - a Date, a plain object, or a number reaching a timestamp or jsonb parameter fails with "The string argument must
//   be of type string or an instance of Buffer or ArrayBuffer" (the system.cleanup production failure);
// - a string or number compared with a boolean is serialized as false (no error, wrong rows);
// - a boolean cannot be cast to jsonb or passed where jsonb is expected (PGlite sends it as text and accepts it);
// - count(*) and sum(...) come back as strings (int8 and numeric), PGlite returns numbers.
// A value only avoids all of this when drizzle binds it through a column encoder (typed operators such as
// lt(table.col, date), .values(), .set()). This test type-checks every source file that builds SQL and fails when a raw
// parameter (inside a sql`` template, sql.param, sql.join, or an operator whose left side is sql`` rather than a
// column) has a type other than string, number or bigint, and when sql<number> counts or sums without a cast.
// tests/pg/sql-params.pg.test.ts shows each behavior on real Postgres.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, "src", "__sql_param_guard_fixture__.ts");

/** Comparison operators of drizzle-orm that bind their right side through the left side's column encoder. */
const OPERATORS = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte", "between", "notBetween", "inArray", "notInArray", "like", "ilike", "notLike",
  "notIlike", "arrayContains", "arrayContained", "arrayOverlaps",
]);
const INT8_RESULT = /\b(count|sum|avg)\s*\(/i;
const NUMBER_CAST = /::\s*(int|int4|integer|smallint|float4|float8|real|double precision)\b/i;

type Finding = { file: string; line: number; kind: string; problem: string; expr: string; type: string };

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("drizzle-orm") || /\bsql\s*[`<.(]/.test(text)) out.push(full);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "scripts"));
  return out;
}

function audit(rootNames: string[], virtual: Record<string, string>): { findings: Finding[]; rawParams: number } {
  const configPath = path.join(ROOT, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!parsed) throw new Error("tsconfig.json could not be parsed");
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, plugins: [] };
  const host = ts.createCompilerHost(options, true);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (f) => f in virtual || baseFileExists(f);
  host.readFile = (f) => (f in virtual ? virtual[f] : baseReadFile(f));
  host.getSourceFile = (f, lang, onError, create) =>
    f in virtual ? ts.createSourceFile(f, virtual[f]!, lang, true) : baseGetSourceFile(f, lang, onError, create);
  const program = ts.createProgram([...rootNames, ...Object.keys(virtual)], options, host);
  const checker = program.getTypeChecker();
  const wanted = new Set([...rootNames, ...Object.keys(virtual)].map((f) => path.resolve(f)));

  const isDrizzleFile = (fileName: string) => fileName.replace(/\\/g, "/").includes("/node_modules/drizzle-orm/");
  // Classes, interfaces and functions of drizzle (SQL, columns, tables, operators). Not type aliases or mapped types:
  // a selected row (typeof table.$inferSelect) is a plain object declared through drizzle's mapped types.
  const DRIZZLE_KINDS = new Set([
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.MethodSignature,
  ]);
  const declaredInDrizzle = (t: ts.Type): boolean =>
    Boolean(t.getSymbol()?.declarations?.some((d) => DRIZZLE_KINDS.has(d.kind) && isDrizzleFile(d.getSourceFile().fileName)));
  const nullish = (t: ts.Type) => Boolean(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never));
  /** Drizzle objects (SQL, columns, tables, subqueries, placeholders, params) are embedded, never sent as raw values. */
  const embeddable = (t: ts.Type): boolean => {
    if (t.isUnion()) return t.types.every((m) => embeddable(m) || nullish(m));
    if (t.isIntersection()) return t.types.some(embeddable);
    return declaredInDrizzle(t) || Boolean(t.getProperty("getSQL"));
  };
  /** Why a raw parameter of this type is unsafe on postgres.js, or null when it is a string, number or bigint. */
  const problemOf = (t: ts.Type, depth = 0): string | null => {
    if (depth > 5) return null;
    if (t.isUnion()) {
      for (const m of t.types) {
        if (embeddable(m)) continue;
        const p = problemOf(m, depth + 1);
        if (p) return p;
      }
      return null;
    }
    const f = t.flags;
    if (f & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike) || nullish(t)) return null;
    if (f & ts.TypeFlags.BooleanLike) return "boolean";
    if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "any or unknown";
    if (f & ts.TypeFlags.TypeParameter) {
      const c = checker.getBaseConstraintOfType(t);
      return c && c !== t ? problemOf(c, depth + 1) : "unconstrained type parameter";
    }
    if (embeddable(t)) return null;
    if ((t.getSymbol() ?? t.aliasSymbol)?.getName() === "Date") return "Date";
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      // drizzle expands an array into a parenthesized list of parameters: every element must be safe.
      for (const el of checker.getTypeArguments(t as ts.TypeReference)) {
        if (embeddable(el)) continue;
        const p = problemOf(el, depth + 1);
        if (p) return `array of ${p}`;
      }
      return null;
    }
    return "object";
  };
  const fromDrizzle = (expr: ts.Expression) => declaredInDrizzle(checker.getTypeAtLocation(expr));
  const hasColumnEncoder = (expr: ts.Expression) => {
    const t = checker.getTypeAtLocation(expr);
    return (t.isUnion() ? t.types.filter((m) => !nullish(m)) : [t]).every((m) => Boolean(m.getProperty("mapToDriverValue")));
  };

  const findings: Finding[] = [];
  let rawParams = 0;
  const check = (sf: ts.SourceFile, kind: string, expr: ts.Expression, t: ts.Type = checker.getTypeAtLocation(expr)) => {
    if (embeddable(t)) return;
    rawParams++;
    const problem = problemOf(t);
    if (!problem) return;
    findings.push({
      file: path.relative(ROOT, sf.fileName),
      line: sf.getLineAndCharacterOfPosition(expr.getStart(sf)).line + 1,
      kind,
      problem,
      expr: expr.getText(sf).replace(/\s+/g, " ").slice(0, 120),
      type: checker.typeToString(t).slice(0, 120),
    });
  };

  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(path.resolve(sf.fileName))) continue;
    const visit = (node: ts.Node) => {
      if (ts.isTaggedTemplateExpression(node) && fromDrizzle(node.tag)) {
        const tpl = node.template;
        if (ts.isTemplateExpression(tpl)) for (const span of tpl.templateSpans) check(sf, "sql`` parameter", span.expression);
        // int8 and numeric results are strings on postgres.js: sql<number>`count(*)` needs ::int or .mapWith(Number).
        const text = ts.isTemplateExpression(tpl) ? [tpl.head.text, ...tpl.templateSpans.map((s) => s.literal.text)].join(" ") : tpl.text;
        const typeArg = node.typeArguments?.[0];
        const mapped = ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === "mapWith";
        if (typeArg && INT8_RESULT.test(text) && !NUMBER_CAST.test(text) && !mapped) {
          const t = checker.getTypeFromTypeNode(typeArg);
          const members = t.isUnion() ? t.types : [t];
          if (members.some((m) => m.flags & ts.TypeFlags.NumberLike) && !members.some((m) => m.flags & ts.TypeFlags.StringLike)) {
            findings.push({
              file: path.relative(ROOT, sf.fileName),
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              kind: "sql<number> result",
              problem: "count, sum or avg without ::int or .mapWith(Number) (a string on postgres.js)",
              expr: node.getText(sf).replace(/\s+/g, " ").slice(0, 120),
              type: checker.typeToString(t),
            });
          }
        }
      }
      if (ts.isCallExpression(node) && fromDrizzle(node.expression)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (ts.isPropertyAccessExpression(callee) && name === "param" && node.arguments.length === 1) {
          check(sf, "sql.param without encoder", node.arguments[0]!);
        } else if (ts.isPropertyAccessExpression(callee) && name === "join" && node.arguments[0]) {
          const t = checker.getTypeAtLocation(node.arguments[0]);
          if (checker.isArrayType(t)) {
            const el = checker.getTypeArguments(t as ts.TypeReference)[0];
            if (el) check(sf, "sql.join element", node.arguments[0], el);
          }
        } else if (OPERATORS.has(name) && node.arguments.length >= 2 && !hasColumnEncoder(node.arguments[0]!)) {
          for (const arg of node.arguments.slice(1)) check(sf, `${name}() with a sql left side`, arg);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { findings, rawParams };
}

const format = (f: Finding) => `${f.file}:${f.line} ${f.kind}: ${f.problem} in \`${f.expr}\` (${f.type})`;

// Every line marked "BAD <problem>" must be reported with that problem, and nothing else.
const FIXTURE_SOURCE = `
import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import { jobs, users } from "@/db/schema";
const at = new Date();
const payload = { a: 1 };
const loose = JSON.parse("1") as unknown;
const flag = true as boolean;
declare const row: typeof jobs.$inferSelect;
export const bad = [
  sql\`\${jobs.payload} = \${row}\`, // BAD object
  lt(sql\`coalesce(\${jobs.finishedAt}, \${jobs.createdAt})\`, at), // BAD Date
  sql\`\${jobs.runAt} < \${at}\`, // BAD Date
  sql\`\${users.preferences} || \${payload}::jsonb\`, // BAD object
  sql\`\${users.twoFactorEnabled} = \${flag}\`, // BAD boolean
  sql\`\${jobs.id} = \${loose}\`, // BAD any or unknown
  sql\`\${jobs.runAt} in \${[at, at]}\`, // BAD array of Date
  sql.param(at), // BAD Date
  sql.join([at, at], sql\`, \`), // BAD Date
  sql<number>\`count(*)\`, // BAD count, sum or avg without ::int or .mapWith(Number) (a string on postgres.js)
];
export const good = [
  lt(jobs.finishedAt, at),
  and(eq(jobs.status, "dead"), lt(jobs.createdAt, at)),
  eq(users.twoFactorEnabled, flag),
  inArray(jobs.id, ["00000000-0000-0000-0000-000000000000"]),
  sql\`\${jobs.runAt} < \${at.toISOString()}::timestamptz\`,
  sql\`\${users.preferences} || \${JSON.stringify(payload)}::jsonb\`,
  sql\`\${jobs.id} in \${["a", "b"]}\`,
  sql\`\${jobs.attempts} + \${1}\`,
  sql.param(at, jobs.runAt),
  sql.join([sql\`a\`, jobs.id], sql\`, \`),
  sql<number>\`count(*)::int\`,
  sql<number>\`count(*)\`.mapWith(Number),
  sql<string>\`sum(\${jobs.attempts})\`,
  count(),
];
`;

describe("postgres.js parameter safety (static)", () => {
  it("the guard reports exactly the unsafe forms of a fixture", { timeout: 180_000 }, () => {
    const { findings } = audit([], { [FIXTURE]: FIXTURE_SOURCE });
    const expected = FIXTURE_SOURCE.split("\n").flatMap((line, i) => {
      const m = /\/\/ BAD (.+)$/.exec(line);
      return m ? [`${i + 1} ${m[1]}`] : [];
    });
    expect(expected.length).toBeGreaterThan(5);
    const got = [...findings].sort((a, b) => a.line - b.line).map((f) => `${f.line} ${f.problem}`);
    expect(got, findings.map(format).join("\n")).toEqual(expected);
  });

  it("no raw parameter in src or scripts is a Date, boolean, object or untyped value", { timeout: 180_000 }, () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    const { findings, rawParams } = audit(files, {});
    // Sanity: the scan saw the raw parameters of the code base (a broken type resolution would see none).
    expect(rawParams).toBeGreaterThan(20);
    expect(
      findings.map(format),
      "Bind the value through a column (typed operators, .values(), .set()), or send a string: date.toISOString() with " +
        "::timestamptz, JSON.stringify(value) with ::jsonb, ::int on count(*). See the header of this file.",
    ).toEqual([]);
  });
});
