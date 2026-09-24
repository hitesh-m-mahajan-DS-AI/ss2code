import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeProjectPath, sourcePolicyFindings } from "../src/lib/security.ts";

test("generated paths remain in the revision root", () => {
  assert.equal(assertSafeProjectPath("src/components/Hero.tsx"), "src/components/Hero.tsx");
  assert.throws(() => assertSafeProjectPath("../.env"));
  assert.throws(() => assertSafeProjectPath("/etc/passwd"));
  assert.throws(() => assertSafeProjectPath("src\\unsafe.ts"));
});

test("source policy blocks network, secret, and execution hazards", () => {
  const findings = sourcePolicyFindings("src/App.tsx", "const token = process.env.API_KEY; fetch('https://bad.example'); eval('x')", ["react"]);
  assert.ok(findings.some((finding) => finding.includes("process")));
  assert.ok(findings.some((finding) => finding.includes("fetch")));
  assert.ok(findings.some((finding) => finding.includes("eval")));
});

test("source policy permits approved local React modules", () => {
  const findings = sourcePolicyFindings("src/App.tsx", "import React from 'react'; export default function App(){ return <main /> }", ["react"]);
  assert.deepEqual(findings, []);
});
