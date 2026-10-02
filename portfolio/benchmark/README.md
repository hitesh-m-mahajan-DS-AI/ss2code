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

Each run produces a fresh UUID directory containing metadata, source hashes, prompt version, dataset hash, routing configuration, per-case results, candidate sources, pass-level findings and successful screenshot/diff pairs. Files are private and ignored by Git. Failures remain in `results.json`. A failed oracle self-test exits nonzero; live failures are legitimate experiment outcomes and appear in its report rather than aborting remaining cases.

## Lanes and metrics

- **Direct:** screenshot → schema-validated project → deterministic gates.
- **Staged:** screenshot → VisualSpec → tokens → tree → file plan → generated code → gates.
- **Repair:** staged plus at most two existing-file patches. Only a gate-passing candidate can win, with nondecreasing pixel agreement among passing candidates.
- **Self-test:** oracle source → gates. Never call this an AI success rate.

Completion requires a rendered candidate with no horizontal overflow, serious/critical axe violations or critical visual findings. First-build rate records successful compilation/rendering, not full acceptance. Pixel agreement is renderer-defined image similarity, **not perceptual correctness or functional correctness**. Geometry and text coverage are reported with measurement counts and are conditional on accepted outputs. Failed render diagnostics remain available separately, but are not silently assigned perfect or zero image scores.

Elapsed time includes orchestration, provider fallback and rendering. Provider-attempt telemetry excludes retry sleep in new runs. Resolved models are recorded; free-model availability can change. Report failure category and rate limits alongside quality. The comparator refuses mismatched datasets, code/configuration, environment or case coverage; it shows paired differences without asserting statistical significance.

Group-bootstrap completion intervals use seed 42 and 2,000 resamples. Fewer than two groups gives no interval; with two to eight groups even a degenerate [1,1] interval is **not evidence of generalization**. Do not count variants or repeats as independent templates.

## Before a publishable experiment

Freeze dataset/prompt/code/routing hashes and run order; pre-register primary endpoint (failure-inclusive completion), secondary metrics and all exclusions. Counterbalance lanes across time windows to reduce free-provider congestion bias. Expand independent licensed template families before power analysis; never select only successful attempts. Keep a new untouched holdout for future tuning rounds.

For human visual review, hide lane/model identities, randomize pair order, have at least two consenting independent reviewers score layout, text, typography, colour and interaction separately, and report agreement plus disagreements. No human scores have been collected. See the [study protocol](../analytics/STUDY_PROTOCOL.md).
