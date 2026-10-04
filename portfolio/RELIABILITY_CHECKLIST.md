# Reliability implementation checklist

Updated 4 October 2026. README.md and prompts.md remain the authoritative target specifications. This checklist records local implementation, not a claim that every product aspiration is complete.

## Completed implementation

- [x] Read both specifications completely before edits; read the installed Next.js route guidance.
- [x] Preserve existing image/video/paste, blueprint/tree, preview/compare, inspector, refinement, history and export features.
- [x] Keep inference exclusively on official OpenRouter with live capability/zero-price filtering; no direct provider keys or paid fallback.
- [x] Replace vulnerable upstream braces recursion with a documented bounded MIT fork; include it and matching locks in renderer/export installs. No audit suppression or invented upstream patched release.
- [x] Send the original reference to code generation; bound repair output/reasoning budgets and avoid images for syntax-only repairs.
- [x] Bind generation to exact approved file count/path enums, reject duplicates locally, constrain patches to existing approved paths and give one field-level format retry.
- [x] Implement P01 with validated MIME/dimensions/frame readiness; keep unknown design/state roles explicit instead of spending an inference call on measured metadata.
- [x] Validate exact reference/spec/target dimensions before queueing inference, enforce finite in-viewport `[x, y, width, height]` regions and unique region IDs, and reject invalid old specifications on refinement without altering existing ready exports.
- [x] Include actual schema, system instructions and prompt version in checkpoint fingerprints, so changed contracts cannot reuse stale model responses.
- [x] Allow private repairs to remove existing blockers incrementally without introducing new ones; require zero blockers and final QA for publication.
- [x] Check axe accessibility and document overflow at reference/768/360px; make missing critical regions/text/geometry blocking and provide actionable repair diagnostics.
- [x] Correct the authored oracle table's mobile scroll area with a named keyboard-focusable region and visible focus styling; retain its failed pre-fix instrument run and archived dataset.
- [x] Distinguish full file paths for assistive technology and automated file-tree selection, including duplicate basenames.
- [x] Retain private deterministic candidate metadata/capture/diff evidence, including rejected candidates; these cannot become published revisions merely by being captured.
- [x] Add secret-safe environment doctor and bounded real upload/analysis/worker/generation/review/export test with frozen fingerprints and failure-inclusive results.
- [x] Record validated benchmark intermediate responses and every rendered candidate, rather than only successful captures.
- [x] Block forecast promotion for missing/invalid evidence, interval coverage below 80%, too few calibration observations or worse-than-baseline MAE. Preserve the previous registry on refusal.
- [x] Update local setup/security guidance and add dependency scanning to CI.
- [x] Synchronize browser failure-recovery checks with completed project restoration and assert the actual restored failed job, while retaining a capture on future test failures.
- [x] Load environment configuration before spawning the web/worker launcher; bind local launcher and test servers to loopback by default.

## Release verification

Use [EVIDENCE.md](EVIDENCE.md) for dated command outcomes and the machine-readable live report. A checked implementation item does not imply that AI output passed acceptance. Run production compilation after browser/live tests because Next.js development updates its generated type imports.

```powershell
npm run doctor
npm audit --audit-level=high
npm run typecheck
npm run lint
# Set SANDBOX_MODE=docker in this terminal for the renderer checks.
npm test
npm run test:e2e
npm run build
.venv/Scripts/python.exe -m unittest discover -s portfolio/forecasting -p 'test_*.py' -v
```

## Not certified or silently marked complete

- Arbitrary-website pixel-perfect reconstruction, dependable free-provider availability or production accuracy. The earlier six-attempt benchmark pilot was 0/6; retain that denominator. Small authored samples and studio acceptance are not independent visual proof.
- Nominal 90% forecast coverage. The measured historical run remains 72.6% and blocked; fixing promotion safety does not change its statistics. A new untouched labelled period is needed for a defensible model-improvement claim.
- Broad document reasoning/retrieval quality. Sixteen authored lexical questions are a smoke test, not a representative semantic/LLM evaluation or proof against all prompt injection.
- Full account recovery, automatic retention/deletion, PDF/design/ZIP ingestion, multi-reference/multi-state reconstruction, multi-tenant scaling and real-user accessibility evaluation. These remain product work; existing supported features are preserved.
- Public deployment or off-host restore certification. The user explicitly chose local implementation/testing without infrastructure purchase. Docker and local export verification do not establish these outcomes.

Evidence is traceable, not tamper-proof: source hashes and local files are not a signed immutable audit store. A clean npm audit does not assess the vendored fork. Automated accessibility/pixel checks do not replace independent human review.
