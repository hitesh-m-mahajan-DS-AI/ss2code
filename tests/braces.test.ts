import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dependencyRequire = createRequire(require.resolve("micromatch"));
const braces = dependencyRequire("braces");

test("installed bounded fork preserves ordinary globs and rejects excessive nesting", () => {
  assert.equal(dependencyRequire("braces/package.json").name, "@ss2code/braces-bounded");
  assert.deepEqual(braces.expand("src/{app,components}/*.{ts,tsx}"), ["src/app/*.ts", "src/app/*.tsx", "src/components/*.ts", "src/components/*.tsx"]);
  assert.equal(braces.compile("{a,b}"), "(a|b)");
  const attack = "{".repeat(10000) + "a,b" + "}".repeat(10000);
  for (const method of ["parse", "compile", "expand", "stringify"]) assert.throws(() => braces[method](attack), /nesting exceeds the safety limit/);
  // Stay below upstream's character limit to exercise the actual parser stack guard.
  assert.throws(() => braces.parse("{]".repeat(1000)), /nesting exceeds the safety limit/);
  const ast: { type: string; nodes: unknown[] } = { type: "root", nodes: [] };
  ast.nodes.push(ast);
  for (const method of ["compile", "expand", "stringify"]) assert.throws(() => braces[method](ast), /cyclic brace AST/);
  let deep: unknown = { type: "text", value: "a" };
  for (let i = 0; i < 100; i++) deep = { type: "root", nodes: [deep] };
  for (const method of ["compile", "expand", "stringify"]) assert.throws(() => braces[method](deep), /AST exceeds the safety limit/);
});
