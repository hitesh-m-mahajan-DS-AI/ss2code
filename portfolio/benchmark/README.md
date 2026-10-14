# Screenshot reconstruction evaluation

## Dataset / system card

`npm run benchmark:fixtures` captures 24 original pages in Chromium: dashboard, table, settings, login, editorial, pricing, catalog and status, each in desktop/mobile/dark variants. The authoring code is the provenance source; no third-party screenshots or trademarks are scraped. References and their SHA-256 hashes live in `.data/benchmarks/pilot/manifest.json`.

Splits are by **template family**, not screenshot: development has four families/12 cases; validation two/six; sealed holdout two/six. Variant overlap across splits is rejected. Selection rotates across families before variants. Ground truth currently includes visible text and one page-level region; it does not yet measure detailed component segmentation. Fixtures do not represent arbitrary websites, motion, popovers, real asset libraries or diverse scripts/fonts.

The manifest contains oracle code for infrastructure self-tests. Live lanes receive the reference image/viewport and their own model-produced intermediate outputs, **not oracle source or truth**. Truth is used by evaluation only.

## Commands

```powershell
npm run benchmark:fixtures
npm run benchmark:run -- --lane self-test --limit 12
npm run benchmark:run -- --lane self-test --split validation --limit 6
npm run benchmark:run -- --lane direct --limit 4 --repeats 2
npm run benchmark:run -- --lane staged --limit 4 --repeats 2
npm run benchmark:run -- --lane repair --limit 4 --repeats 2
npm run benchmark:compare -- RUN_UUID_DIRECT RUN_UUID_STAGED RUN_UUID_REPAIR
```

Live calls require `.env.local` and may exhaust free quotas. Start with one case. Limits are 100 cases, five repeats and two repair passes per case; underlying provider retries/timeouts remain bounded by server settings. A complete staged case makes several calls. `--cases login-dark` selects named cases for diagnosis. `--split holdout --allow-holdout` is an explicit release evaluation; do not tune prompts on those outcomes.

Each run produces a fresh UUID directory containing metadata, source hashes, prompt version, dataset hash, routing configuration, per-case results, validated intermediate stage responses, candidate sources, pass-level findings and screenshot/diff pairs for every rendered candidate (including rejected candidates). Files are private and ignored by Git. Failures remain in `results.json`. A failed oracle self-test exits nonzero; live failures are legitimate experiment outcomes and appear in its report rather than aborting remaining cases.

## Lanes and metrics

- **Direct:** screenshot → schema-validated project → deterministic gates.
- **Staged:** screenshot → VisualSpec → tokens → tree → file plan → generated code → gates.
- **Repair:** staged plus at most two existing-file patches. Only a gate-passing candidate can win, with nondecreasing pixel agreement among passing candidates.
- **Self-test:** oracle source → gates. Never call this an AI success rate.

Completion requires a rendered candidate with no horizontal overflow, serious/critical axe violations or critical visual findings. First-build rate records successful compilation/rendering, not full acceptance. Pixel agreement is renderer-defined image similarity, **not perceptual correctness or functional correctness**. Geometry and text coverage are reported with measurement counts and are conditional on accepted outputs. Failed render diagnostics remain available separately, but are not silently assigned perfect or zero image scores.

### Region-level fidelity instrumentation (14 October 2026)

The renderer records each uniquely mapped region's signed left/top/right/bottom edge error in CSS pixels and material horizontal/vertical gaps between adjacent mapped regions. Typography is measured from browser-computed styles on an explicitly marked text element (`data-ss2-typography`) inside the exact approved layout region. A typography mismatch blocks publication only when the observation is high-confidence and tied to an exact region; ambiguous or unmapped targets remain unverified. Material edge errors in critical regions also block. Existing pixel, text and aggregate geometry thresholds were retained; none were lowered.

This improves diagnosis and gate safety, not AI accuracy. Unless an independent oracle is supplied, these measurements compare with the model-produced VisualSpec. Authored benchmark truth still has only a page-level region, so it cannot establish component-level generalization or validate P02 region accuracy. Expand and independently review region-level truth before publishing component/layout quality claims.

New benchmark summaries include mean/max absolute region-edge error, the count of adjacent-region pairs checked, the mean/count of material spacing deviations, and verified/unverified typography-check counts. These remain conditional on successful rendered candidates and actual measurement coverage; absent metrics stay missing, not zero. Historical reports have not been rewritten.

Elapsed time includes orchestration, provider fallback and rendering. Provider-attempt telemetry excludes retry sleep in new runs. Resolved models are recorded; free-model availability can change. Report failure category and rate limits alongside quality. The comparator refuses mismatched datasets, code/configuration, environment or case coverage; it shows paired differences without asserting statistical significance.

The adapter now requests native JSON-schema output when `structured_outputs` is advertised, requests JSON-object output where only that mode is available, and validates every result with the local Zod contract. API strict mode is disabled for contracts with optional/recursive fields; local schema validation remains authoritative. Compatible routes must honor the native schema parameter. Advertised reasoning budgets are capped at 2,048 tokens for generation/repair and 1,024 for other stages, or use an explicitly supported low effort. Generation and patch output budgets are 16,000 tokens; other outputs are 6,000. Staged generation receives the original reference image, while syntax repairs need no image. These controls follow [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs) and [reasoning metadata](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

The separate `npm run test:live -- --limit 2` command exercises the actual studio API and worker, including classification, source/accessibility reviews and final QA. Its `.data/live-smoke/<UUID>` results are **not a benchmark lane** and must not be pooled into a lane comparison. It automatically submits the model-produced specification without human confirmation, and evaluates studio acceptance against that specification, not an independent oracle. Inspect retained reference/capture differences before asserting fidelity.

Studio P01 now classifies already validated file type, dimensions and required frame/page selection deterministically; semantic design extraction remains the P02 AI call. P06 uses an exact-count, approved-path-enum contract plus local duplicate detection. P12/P14 contracts allow only existing approved paths. One bounded format retry gets field-level issue codes, never raw completion content. Private deterministic candidate metadata/capture/diff evidence is retained under the run's `private/candidates`, even when no revision is published. These are diagnostic artifacts, not approved exports or accepted-output scores.

P02 region coordinates are explicitly finite `[x, y, width, height]` percentages, not box corners, with positive sizes, unique IDs and boxes contained in the viewport. Invalid responses receive the same single format retry; the application does not silently reinterpret coordinates. Checkpoints incorporate the actual schema, system instructions and prompt version. On 4 October, reference/768/360px accessibility checks detected an unfocusable mobile table scroll region in the authored oracle. Its markup/focus styling were corrected, the earlier dataset was archived locally, and the failed instrument run was retained. New manifest fingerprints identify the changed fixture baseline; do not compare it as an unchanged experiment.

Group-bootstrap completion intervals use seed 42 and 2,000 resamples. Fewer than two groups gives no interval; with two to eight groups even a degenerate [1,1] interval is **not evidence of generalization**. Do not count variants or repeats as independent templates.

The [2 October reliability pilot](reports/2026-10-02-reliability-pilot.json) is a reviewed public metadata-only exception to the private-artifact policy: it contains authored case IDs, frozen configuration hashes, model IDs and failure-inclusive results, but no screenshots, generated source, prompts or credentials. All six live attempts failed full acceptance; see [dated evidence](../EVIDENCE.md) for diagnosis and study limitations.

The [4 October local reliability report](reports/2026-10-04-local-reliability.json) separately records three real studio workflow diagnostics (0/2, 0/2 and 0/1 ready/exported), deterministic engineering checks and both failed/corrected oracle instrument outcomes. It is not a lane comparison, independent human accuracy study or successful reconstruction claim. Source/configuration changed between runs; the last run predeclared no optional visual repair.

## Before a publishable experiment

Freeze dataset/prompt/code/routing hashes and run order; pre-register primary endpoint (failure-inclusive completion), secondary metrics and all exclusions. Counterbalance lanes across time windows to reduce free-provider congestion bias. Expand independent licensed template families before power analysis; never select only successful attempts. Keep a new untouched holdout for future tuning rounds.

For human visual review, hide lane/model identities, randomize pair order, have at least two consenting independent reviewers score layout, text, typography, colour and interaction separately, and report agreement plus disagreements. No human scores have been collected. See the [study protocol](../analytics/STUDY_PROTOCOL.md).
