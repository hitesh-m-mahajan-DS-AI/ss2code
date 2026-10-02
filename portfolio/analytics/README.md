# Operational analytics and experiment design

Run `npm run analytics:report` from the repo root. Open the returned `dashboard.html` in a browser or VS Code. It uses no external scripts, fonts or requests. The report and normalized SQLite warehouse live under a new private `.data/analytics/<uuid>/` directory each run. An empty installation reports no observations, not invented activity.

## Data dictionary

| Table / grain | Fields and meaning |
| --- | --- |
| projects / workspace | Report-local hashed ID and whether a current VisualSpec was observed |
| jobs / submitted generation or refinement | Hashed IDs, current phase, creation/update times; current status snapshot, not every state transition |
| revisions / published ready artifact | Hashed project/revision IDs and measured pixel agreement; incomplete unpublished revisions excluded |
| spans / instrumented stage or provider attempt | Trace/source/stage/outcome, duration, model, attempt, safe error code, optional provider tokens/cost |

`queries.sql` defines observed project coverage, job outcomes, daily cohorts, stage failures and model reliability. Foreign-key validation runs before publishing. IDs are salted anew each report, so do not join snapshots across reports by ID. Trace/project IDs in the original telemetry database remain private operational identifiers.

## Metric contract

- Model attempt success rate = `ok attempts / all recorded attempts`, grouped by source, role and model. It is not end-to-end project success; retries add attempts.
- Job durations use latest update minus creation, including waiting. Nonterminal jobs are incomplete observations, not completed latency measurements.
- Studio p50/p95 are distributions of instrumented **stage** durations, not session latency. Stage spans can overlap model spans; never sum them to claim wall-clock time.
- Reported usage is a partial sum with a separate accounting-coverage count. Unknown is SQL NULL, distinct from zero. Provider credits exclude compute, storage and operational cost. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) is captured from JSON or terminal streaming chunks.
- Uploaded/spec/generated/validated/export-built counts are observed **project coverage**, not a conversion funnel. Old instrumentation gaps, retries, multiple jobs and cookie loss prevent causal session attribution.
- `export_built` means the archive stream completed on the server. It does not prove the browser saved or ran the download.

## Decisions this can support

Investigate a role with repeated schema errors, inspect high failure-rate free routes, and separate provider outages from compiler/visual problems. Before comparing model effectiveness, match workload and account for routing selection bias. Before claiming user time saved, collect consented task-level evidence using [STUDY_PROTOCOL.md](STUDY_PROTOCOL.md).

Telemetry is enabled by default and can be disabled with `TELEMETRY_ENABLED=false`. No raw prompt/image/code/error bodies are recorded. Reports are administrator-only local artifacts, not a public route. Keep storage ACLs restrictive; automatic deletion/retention scheduling and hosted analytics have not been implemented.
