# Dated evidence and honest portfolio claims

Recorded 2 October 2026, Europe/London. Artifact timestamps are UTC, so early local runs may carry 1 October UTC dates. These are local measurements, not production or user-study results.

## Working implementations

Four runnable tracks are documented in [README.md](README.md): a screenshot evaluation harness, operational SQL analytics, an independently trained forecasting project and a citation-verified document assistant. Root product specifications remain aspirational where explicitly identified in [ARCHITECTURE.md](ARCHITECTURE.md).

## Screenshot evidence

After fixing a dark-login input contrast defect, all 12 development and six validation **oracle** cases passed deterministic gates:

| Run | Cases / groups | Completion | Mean pixel agreement |
| --- | --- | --- | --- |
| `18fc0d06-9e54-411e-bcbd-2a3e21bb86bb` | 12 / 4 | 12/12 | 0.9963 |
| `68e4ea06-be7b-43d4-bc89-398fe47fda7e` | 6 / 2 | 6/6 | 0.9819 |

These are instrument checks using authored source, **not AI quality scores**. Six holdout cases have not been evaluated. The failed pre-fix oracle run is retained locally, not hidden.

Live free-only pilot calls on one authored dashboard produced these recorded outcomes:

| Run | Lane | Recorded outcome |
| --- | --- | --- |
| `22fba14d-23a7-4c4d-8f5d-c9c61d5a3055` | direct | Failed validation |
| `7d67109f-b0f6-4697-b6ee-4f9f2bdc5520` | staged | Failed during generation |
| `211bca23-a222-451c-80ce-23e5164bb8ff` | repair | First render built; run failed during refinement, before any applied repair |
| `dc9e303f-7a92-4141-becb-dbadf9c25a3b` | direct diagnostic | Timed out during generation after bounded fallback |

These runs are not a fair post-fix ablation: code/routing/fixture instrumentation changed during diagnosis, and early runs lacked candidate-level artifacts. They establish neither a winning lane nor a successful live screenshot-quality rate. Safe telemetry exposed 429s, timeouts and schema failures, including a specialist safety classifier entering the former candidate pool. Named suitable families now precede the generic free router, specialist classifiers are excluded, and timeout codes are explicit.

Investigation also found that optional repair failure could discard a previously validated candidate. That boundary is corrected in the harness and studio; previous failed run outcomes are **not retroactively relabelled as successes**. New runs retain candidate source, pass findings, selected candidate and optional-refinement warnings. Full live post-fix effectiveness remains to be measured with a frozen experiment and available providers.

## Forecasting evidence

Public reproducibility record: [reports/latest.json](forecasting/reports/latest.json), run `20261001T235659Z-fd2caece`. Data SHA-256 and library versions are recorded there.

- UCI daily historical data: 731 rows, 703 usable; held-out period 2012-09-17 through 2012-12-31 (106 days).
- Ridge selected by earlier temporal validation: MAE 957.88 vs seasonal-naive 1,380.12 rentals/day, **30.6% lower**.
- Nominal 90% intervals achieved **72.6% empirical coverage**. Monitoring requests review. This is a material limitation, not a production-ready uncertainty claim.
- Actual download, training, next-day serving and labelled monitoring executed. Four Python tests cover data/leakage, calibration/metrics, training/serving/registry and tampering. Synthetic lifecycle-test data is not used in the public performance claim.

## Document evidence

[Retrieval report](document-assistant/reports/retrieval.json): 16 authored smoke questions (12 answerable, four unrelated), recall@3 1.0, MRR 0.9583 and unrelated-question abstention 1.0. These are lexical retrieval metrics, **not semantic retrieval or LLM correctness claims**.

One actual free OpenRouter evidence-selection query, “Where do I configure OPENROUTER_API_KEY?”, resolved to `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` and returned the exact verified source quote “Configure OPENROUTER_API_KEY in .env.local.” No real key was sent as source content. Operational accounting recorded 692 tokens and zero provider credits for that request; it excludes infrastructure cost. Later query artifacts persist privately with source hashes and prompt version.

## Application and analytics checks

TypeScript, expanded lint and all 21 Node tests passed. The CLI/browser analytics regression verifies privacy, keyboard scrolling, no page overflow and no serious/critical axe violations at 1440px and 390px; desktop/mobile captures were also visually inspected. Production compilation passed without the initially detected dynamic-filesystem tracing warning. Chromium integration passed recovery, inspector, history, comparison, mobile controls, ZIP download, independent export install/build, ownership, CSRF, idempotency, failure recovery, upload persistence and video frame selection. These use explicit deterministic test fixtures, not mocked claims of model accuracy.

The SQL warehouse/dashboard generated successfully from local observations, with unknown studio latency reported as null and no invented user activity. SQL tests verify failure denominators, missing accounting versus zero and empty coverage. No user-study effect, conversion improvement or business impact has been measured. A prospective [study protocol](analytics/STUDY_PROTOCOL.md) is supplied.

Local Docker execution was blocked by an unavailable Docker daemon; public deployment, remote CI status and a restore drill are not asserted as passed. See the final release message for the latest commit/push and verification status.

## Defensible CV wording

“Built a screenshot-to-code evaluation and observability system with capability-aware free-model routing, deterministic build/accessibility gates, private SQL analytics and failure-inclusive experiment reports.”

“Implemented a reproducible one-day demand forecasting pipeline with chronological model selection; reduced historical test MAE by 30.6% over a seasonal baseline and identified substantial prediction-interval undercoverage.”

“Built an extractive document assistant with source hashing, stale-index rejection, verified citations and a small explicit retrieval evaluation.”

Do not replace the qualifications with ‘production-grade AI accuracy’, ‘guaranteed pixel-perfect websites’, ‘90% reliable intervals’ or invented internship/client impact.
