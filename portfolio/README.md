# Four-track AI / ML / analytics portfolio

Implemented 2 October 2026. This extends SS2Code; it does not replace the product contracts in the root README and prompts.md. Start with [local studio setup](../LOCAL_SETUP.md), then choose a reproducible demonstration below.

## Current project status

SS2Code is ready to showcase as an **engineering prototype**, not as a complete or proven screenshot-reconstruction product. The local workflow, validation gates and evaluation tooling are implemented, and the latest recorded engineering checks passed. That confirms software behavior only: the studio-diagnostic ledger now records **0/6 ready/exported** across changing prompts/configurations (not a pooled accuracy estimate), six screenshot holdout cases remain unopened, and no blinded human fidelity review has been conducted. The core AI accuracy claim is therefore unproven.

### Copy-ready portfolio description

> Built SS2Code, an OpenRouter-based screenshot-to-code engineering prototype with a local upload-to-preview workflow, isolated rendering, fail-closed validation, and region-level fidelity diagnostics. The system exposes its limitations rather than hiding them: the latest studio diagnostic ledger records 0/6 ready/exported across changing configurations, so reliable arbitrary-website reconstruction remains unproven. Current work focuses on provider resilience and a larger, independently reviewed visual evaluation.

This is a credible portfolio project when presented as an evaluation, reliability and applied-AI engineering effort. Do not describe it as production-ready, reliably accurate, or pixel-perfect.

| Track | Working deliverable | Strongest career evidence |
| --- | --- | --- |
| AI engineering | [Screenshot benchmark](benchmark/README.md), staged OpenRouter orchestration, deterministic gates, bounded repair | Evaluation design, failure handling, routing, secure generated-code execution |
| Data analytics | [Operational SQL warehouse and dashboard](analytics/README.md), metric definitions and study protocol | SQL modelling, data quality, denominators, uncertainty, decision-making |
| ML engineering / data science | [Demand forecasting](forecasting/README.md), trained baselines, temporal validation, serving and monitoring | Leakage prevention, model selection, reproducibility, artifact integrity, honest failure analysis |
| Applied AI | [Evidence-grounded document assistant](document-assistant/README.md), lexical retrieval, verified citations and abstention | Retrieval evaluation, grounded output, stale-data handling, prompt-injection boundaries |

## Repository map

```text
src/server/                    studio, OpenRouter, queue, rendering, telemetry
src/evaluation/contracts.ts    dataset contracts and failure-inclusive statistics
scripts/benchmark*.ts          fixture capture, live/oracle runs, paired comparison
scripts/analytics.ts           private normalized warehouse and static dashboard
portfolio/
  benchmark/                  dataset/system card and experiment procedure
  analytics/                  SQL views, data dictionary, user-study protocol
  forecasting/                independent Python project and measured reports
  document-assistant/         independent TS CLI, corpus and retrieval evaluation
  ARCHITECTURE.md              boundaries and engineering decisions
  OPERATIONS.md               security, incident response and release checklist
  EVIDENCE.md                  dated, measured outcomes and known failures
tests/                        application, security, evaluation and browser tests
.data/                        ignored private datasets, run artifacts and analytics
```

## Run the demonstrations

From the repository root after `npm ci` and `npx playwright install chromium`:

```powershell
npm run benchmark:fixtures
npm run benchmark:run -- --lane self-test --limit 2
npm run analytics:report
npm run documents -- index
npm run documents -- evaluate
npm run documents -- ask --question "Where do I configure OPENROUTER_API_KEY?"
```

These commands require no inference key. Self-test deliberately uses authored reference code: it verifies the measuring instrument, not AI accuracy. Live screenshots and `documents -- ask --live` use the server-side OpenRouter key only. Run the Python project with the separate environment described in its README.

The separate `npm run documents -- evaluate --suite challenge` command measures a frozen 20-question paraphrase/near-match/injection-probe retrieval set. It is descriptive retrieval-only evidence, not a live model answer, semantic-retrieval, groundedness, or prompt-injection score.

## Portfolio presentation

Use [EVIDENCE.md](EVIDENCE.md) for defensible claims, not the aspirational product feature list. In a five-minute demo, walk through the intended upload/blueprint/preview flow, then show a retained live failure and explain its critical visual findings. You can also show the authored real-Chrome regression that proves the typography gate catches a mismatch—but label it clearly as a deterministic harness test, not an AI reconstruction result. Finish with the SQL report and the forecasting interval failure. For the fourth project, edit a corpus file and demonstrate refusal to cite a stale index.

Do not claim production traffic, employer use, a human usability study, guaranteed screenshot fidelity, semantic retrieval, or financial savings. No such outcomes have been established. Public deployment, a consented user study, a larger independently labelled screenshot dataset and future-period model validation remain release/research work, not fabricated portfolio evidence.
