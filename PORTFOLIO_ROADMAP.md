# Portfolio implementation roadmap

Approved 2026-10-02. Product contracts remain README.md and prompts.md.

## Delivery sequence

- [x] A: Versioned screenshot benchmark, split validation, baseline/staged/repair experiment tooling, failure-inclusive reports and human-review protocol. Limited live pilots recorded failures; a larger frozen post-fix comparison remains unmeasured.
- [x] B: Privacy-conscious model/stage telemetry, normalized SQL analytics, keyboard-accessible responsive dashboard and experiment protocol.
- [x] C: Independent forecasting project with public-data provenance, chronological backtests, trained baselines, residual-calibrated intervals, versioned artifacts, batch serving and monitoring. Measured interval undercoverage is documented.
- [x] D: Independent evidence-grounded document assistant with ingestion, lexical retrieval, verified citations, abstention, update handling and evaluation.
- [x] E: Architecture, data/system/model cards, runbooks, case studies, dated evidence and regression tests.

Checked means the implementation/tooling is delivered, not that production readiness or an experiment's desired outcome is established. See [portfolio/EVIDENCE.md](portfolio/EVIDENCE.md).

## External validation / follow-on work

- [ ] Docker-backed execution on a running daemon and remote CI confirmation.
- [ ] Larger frozen live-model study when free-provider availability permits; unopened screenshot holdout stays sealed.
- [ ] Consented human usability/fidelity study; recruitment and data collection have not happened.
- [ ] Approved public deployment and off-host backup/restore drill.
- [ ] Fresh-period forecasting validation and acceptable empirical interval coverage before promotion.

## Evidence policy

Implementation, automated test results, live provider measurements and human-study outcomes are separate statuses. Synthetic benchmark pages are explicitly labelled. No live model or real-user outcome is claimed without a recorded run. Public deployment and paid infrastructure require a separately approved host/budget. Existing local dependency changes are preserved.

## Status log

| Date | Change | Evidence | Limitation |
| --- | --- | --- | --- |
| 2026-10-02 | Inspected repository and authoritative contracts, implemented four tracks | Portfolio READMEs and source | Existing local Next.js 16.3.7 update preserved |
| 2026-10-02 | Screenshot fixtures and live pilots; corrected contrast, specialist routing and optional-refinement retention | Benchmark run IDs in EVIDENCE.md | Oracle success is not AI accuracy; live failures retained |
| 2026-10-02 | Trained/served/monitored forecasting model and evaluated retrieval | Committed JSON reports | Historical forecast undercoverage; tiny authored retrieval set |
| 2026-10-02 | Build, browser/export, SQL, accessibility and lifecycle verification | Tests and EVIDENCE.md | Docker daemon unavailable; no public deployment claim |
