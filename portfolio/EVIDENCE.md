# Dated evidence and honest portfolio claims

Initial record: 2 October 2026, Europe/London; local reliability follow-up: 4 October below. Artifact timestamps are UTC, so early local runs may carry the previous UTC date. These are local measurements, not production or user-study results.

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
| `62519b65-4016-4953-8a1e-3a66bdb13d08` | pre-follow-up direct diagnostic | Timed out after two Gemma rate limits, a Nemotron provider error and a slow fallback |

These runs are not a fair post-fix ablation: code/routing/fixture instrumentation changed during diagnosis, and early runs lacked candidate-level artifacts. They establish neither a winning lane nor a successful live screenshot-quality rate. Safe telemetry exposed 429s, timeouts and schema failures, including a specialist safety classifier entering the former candidate pool. Named suitable families now precede the generic free router, specialist classifiers are excluded, and timeout codes are explicit.

Investigation also found that optional repair failure could discard a previously validated candidate. That boundary is corrected in the harness and studio; previous failed run outcomes are **not retroactively relabelled as successes**. New runs retain candidate source, pass findings, selected candidate and optional-refinement warnings. Full live post-fix effectiveness remains to be measured with a frozen experiment and available providers.

### Frozen Docker-backed reliability pilot

The [sanitized machine-readable report](benchmark/reports/2026-10-02-reliability-pilot.json) preserves six live attempts on two independent development template groups (dashboard and table), one repeat per lane. Dataset, prompt, source, routing and environment fingerprints matched; `benchmark:compare` accepted all three runs. The parent commit is `6de2c60`; recorded source hashes identify the uncommitted reliability patch actually tested.

| Run | Lane | Accepted / attempted | First-build rate | Failure categories |
| --- | --- | --- | --- | --- |
| `c9f00536-bfc7-43af-b784-266190677ed5` | direct | 0/2 | 1/2 | Validation: 2 |
| `00327d6f-40bf-4a4d-94b4-0437523e3ba4` | staged | 0/2 | 0/2 | Validation: 1; visual specification: 1 |
| `8071cc73-11d9-403e-b458-24e4166766ab` | repair | 0/2 | 0/2 | Visual specification: 1; repair provider call: 1 |

Qwen returned schema-valid direct outputs. The dashboard rendered with pixel agreement 0.9907, but failed mobile overflow and serious contrast checks; that diagnostic score is **not an accepted-output quality result**. The direct table and staged dashboard contained source syntax errors. Nemotron returned schema-valid visual analysis, token, hierarchy, file-plan and generation outputs, but generated table source had malformed newline escaping. No repair was applied before the repair provider call exhausted its budget. Safe telemetry recorded 429, 502, timeout and one 400 response; a single bounded follow-up to investigate the 400 instead received 429, so its cause remains unconfirmed.

Native JSON-schema controls and reasoning bounds improved request discipline, not demonstrated reconstruction accuracy. No lane won. Conditional accepted-output pixel/geometry/text scores remain null because there were no accepted candidates. Two-group bootstrap intervals are uninformative. Sequential lane order, dynamic fallback models/free-provider congestion and concurrent local verification during the direct run confound timing; this is not a causal speed comparison. Six holdout cases remain unopened. The next quality study needs more independent templates, counterbalanced runs and provider availability, not relaxed acceptance gates or repeated selection of lucky outputs.

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

TypeScript, expanded lint and all 22 Node tests passed after the reliability follow-up, including a native-schema/format-retry/free-fallback regression. The CLI/browser analytics regression verifies privacy, keyboard scrolling, no page overflow and no serious/critical axe violations at 1440px and 390px; desktop/mobile captures were also visually inspected. Production compilation passed without the initially detected dynamic-filesystem tracing warning. Chromium integration passed recovery, inspector, history, comparison, mobile controls, ZIP download, independent export install/build, ownership, CSRF, idempotency, failure recovery, upload persistence and video frame selection. The latest full Node suite and Chromium integration ran with Docker rendering. These use explicit deterministic test fixtures, not mocked claims of model accuracy.

The SQL warehouse/dashboard generated successfully from local observations, with unknown studio latency reported as null and no invented user activity. SQL tests verify failure denominators, missing accounting versus zero and empty coverage. No user-study effect, conversion improvement or business impact has been measured. A prospective [study protocol](analytics/STUDY_PROTOCOL.md) is supplied.

Both jobs of [GitHub Actions run 36992716170](https://github.com/hitesh-m-mahajan-DS-AI/ss2code/actions/runs/36992716170) passed for commit `6de2c60`, including the Docker build/render checks and forecasting lifecycle. Docker became available locally on 2 October: two oracle cases passed in run `c738e4a3-1584-4e2d-9290-7fd123886a84`. The patched renderer image also built successfully. Compatible brace-expansion patches were applied to the main and export lockfiles; full npm audit reported zero vulnerabilities at verification time. This does not guarantee future vulnerability-free dependencies. Public deployment and an off-host restore drill remain unverified.

## 4 October local reliability follow-up

Scope remained local implementation and testing, as explicitly chosen by the user; no hosting or backup infrastructure was purchased. The [implementation checklist](RELIABILITY_CHECKLIST.md) separates completed engineering from remaining product and quality work.

### Engineering checks

- All **32 Node tests** passed with the rebuilt Docker renderer, including real React/Next.js compilation, 360px-only accessibility failure detection, scoped output contracts, private candidate evidence, routing, queue fencing and security checks.
- TypeScript, lint, independent exported-ZIP install/build and production compilation passed. The first browser rerun timed out waiting for recovery; the test now explicitly waits for completed project restoration and asserts the recovered failed job before checking Retry safely. The subsequent complete browser/export suite passed, including ownership, CSRF, idempotency, upload persistence and video frame selection. Future failures retain a private capture.
- All **five Python tests** passed under the pinned Python 3.12 environment. Actual promotion of historical run `20261001T235659Z-fd2caece` was refused with `NOT_READY` because measured coverage is 72.6%, below the fixed 80% release heuristic. This fixes unsafe promotion, **not interval calibration or nominal 90% coverage**; no tuning on that historical test period was performed.
- The document index/evaluation reran successfully on the same 16 authored lexical smoke questions: recall@3 1.0, MRR 0.9583 and unrelated-question abstention 1.0. No broader semantic, human or live-LLM evaluation is claimed.
- Clean local dependency installation, renderer-image installation, the environment doctor and the full npm audit succeeded. A newly disclosed [braces nesting advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched upstream release at verification time. The project uses a documented MIT compatibility fork with iterative pattern/AST bounds and regression tests in root, renderer and export installs. This is **not an upstream fixed version**; npm audit does not evaluate the local fork and its zero-vulnerability result is not security certification.
- The actual combined production launcher started web and worker using isolated temporary storage without an inference key. HTTP returned 200 and Windows listener inspection confirmed `127.0.0.1:3300`, not a wildcard/public interface. Ctrl+C stopped both test-owned processes and released the port. Explicit Docker production-mode doctor checks also passed. The user's private environment was not overwritten.

The new reference/768/360px accessibility gate correctly rejected the authored table oracle for an unfocusable mobile scroll region. Failed instrument run `fba84fb9-13f9-482b-91a0-276111dc5af4` remains retained (1/2 passed), together with the archived pre-fix dataset. After fixing the fixture's named keyboard-focusable region and focus styling, oracle run `f6613fe2-d9ad-402b-9825-353b6092f13a` passed **4/4 development template groups**, with mean pixel agreement 0.9967. It uses authored source and is **not an AI success rate**. The regenerated manifest has a new fingerprint; it is not an unchanged experiment. Holdout quality cases remain unevaluated.

### Real studio workflow diagnostics

These use actual upload, P01/P02 analysis, queued generation, reviews and publication gates—not benchmark lanes. The original reference is sent to P06. No oracle source/truth is sent to inference, but the model-produced specification is submitted automatically without human correction. Each run has frozen source/schema/prompt/routing/environment fingerprints and preserves every failure. Versions/configuration changed between runs, so they are **not paired causal effectiveness or speed comparisons** and must not be pooled with the earlier 0/6 benchmark pilot.

The [sanitized machine-readable follow-up report](benchmark/reports/2026-10-04-local-reliability.json) includes configuration/source hashes, failure-inclusive outcomes, allowlisted aggregate telemetry and clearly labelled private-candidate diagnostics. It excludes prompts, source, images, ownership identifiers, private paths and raw errors. Unknown accounting remains null.

| Run | Prompt version | Ready/exported | Observed failure |
| --- | --- | --- | --- |
| `a2be3e9d-4917-48b3-843a-33b6b0279484` | 1.2.0 | 0/2 | Dashboard planned files were missing/duplicated; table remained blocked after bounded repairs. |
| `6a1bee37-690c-4253-ac82-a5abd607e962` | 1.3.0 | 0/2 | Dashboard compiled/rendered but failed publication; table analysis failed schema validation after one format retry. |
| `88106d4a-8ea8-43b3-a618-866cb7a56575` | 1.4.0 | 0/1 | Stricter analysis and code contracts passed; required static review exhausted free-route fallback with HTTP 429. Rendered candidate also had three critical visual findings. |

The first run exposed a generic JSON contract that did not bind P06 to the approved manifest. Generation now enforces exact count/path enums and local uniqueness; P12/P14 patches cannot add unapproved files. P01 uses already validated MIME/dimensions/frame readiness rather than an unnecessary inference call. These corrections have deterministic regressions; the earlier failed outcomes have **not** been relabelled as successes.

The second run retained private candidate metadata, capture and diff evidence without publishing an invalid revision. Its initial dashboard capture measured about **98.99% raw pixel agreement**, yet manual inspection showed materially different margins, typography, navigation distribution and card styling. Background dominates that metric; it is not a faithful-reconstruction result. Analysis also supplied corner coordinates where the renderer expects `[x,y,width,height]`. Version 1.4.0 makes that convention explicit and rejects non-finite, empty, duplicate-ID or out-of-viewport regions, rather than silently converting them. Generation rejects reference/spec/target viewport mismatches before queueing model calls. Schema/system/prompt changes invalidate checkpoints.

The final one-reference diagnostic was declared in advance with **zero optional visual-repair iterations**; build repair and required review/publication gates stayed enabled. Nemotron supplied valid P02/P06 responses after two Gemma rate limits. Generated source compiled/rendered with no serious accessibility or document-overflow findings, but three critical regional visual mismatches remained at 98.94% raw pixel agreement. The required static review then exhausted its bounded fallback with rate limits and the workflow failed after 200,526 ms. No revision/export was published. Removing the rate limit alone would not make this candidate acceptable; the fidelity blockers still need correction. This is not proof of successful post-fix screenshot conversion, and no further reruns were selected until green.

The application is a locally verified engineering prototype, **not a perfectly accurate arbitrary-website converter**. Free-provider congestion/schema failures, model-written source defects, tiny evaluations and absent independent human validation remain material. Local hashes/artifacts provide traceability, not a signed tamper-proof audit record. Public deployment and an off-host restore drill remain unverified by user choice.

## Defensible CV wording

“Built a screenshot-to-code evaluation and observability system with capability-aware free-model routing, deterministic build/accessibility gates, private SQL analytics and failure-inclusive experiment reports.”

“Implemented a reproducible one-day demand forecasting pipeline with chronological model selection; reduced historical test MAE by 30.6% over a seasonal baseline and identified substantial prediction-interval undercoverage.”

“Built an extractive document assistant with source hashing, stale-index rejection, verified citations and a small explicit retrieval evaluation.”

Do not replace the qualifications with ‘production-grade AI accuracy’, ‘guaranteed pixel-perfect websites’, ‘90% reliable intervals’ or invented internship/client impact.
