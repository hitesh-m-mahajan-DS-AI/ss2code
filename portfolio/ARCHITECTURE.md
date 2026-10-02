# Architecture and decisions

Decision record: 2026-10-02. Product-level architecture remains in the root specifications. These modules add measurement without sending private data to a new service.

```text
Reference → approved VisualSpec → tokens/tree/file plan → generation
                                                       ↓
                    bounded repair ← build/render/a11y/visual gates
                                                       ↓
                                         immutable revision → export

Model/stage metadata → private telemetry.sqlite → local SQL warehouse → HTML report
Authored references → grouped benchmark → same generator/renderer → private run evidence
UCI daily data → temporal folds → selected model → calibration → test → versioned artifact
Local text corpus → hashed lexical index → retrieved passages → verified quoted evidence
```

## Boundaries

- Studio remains Next.js + React + a separate durable worker on one host. SQLite and assets are private runtime data. Anonymous signed-cookie ownership is not a full account system.
- The screenshot harness calls shared prompt contracts, the existing renderer and manifest policy. Its three lanes are controlled ablations, **not an exact replay of every production reviewer/final-QA stage**. The deterministic gates cannot be overridden by an LLM.
- `traceContext` carries a private trace ID; job context is used when no explicit evaluation trace exists. Telemetry uses allowlisted numbers/labels, never request bodies. Telemetry failure does not fail generation. This is local operational instrumentation, not a hosted tracing service.
- Analytics is an administrator CLI, not a cross-user HTTP endpoint. IDs are salted per report; raw workspace IDs, owners, images, filenames, generated source and prompts are not warehouse columns. Aggregates still deserve access control.
- Forecasting is a separately installable Python command-line project. It does not call an LLM. A batch model does not need to masquerade as a real-time service.
- Document inference reuses the OpenRouter adapter with a dedicated strict evidence schema and trusted internal system instruction. No document tools, shell access or execution are exposed. Citations are exact substrings of retrieved passages.

## Engineering decisions

| Decision | Reason / trade-off |
| --- | --- |
| Free-only capability/price filtering with explicit family preference | No surprise paid inference. Availability, schema fidelity and latency remain uncertain. Specialist safety/guard/embedding/reranking models are excluded from generation candidates. |
| Private filesystem run artifacts with source/configuration hashes | Inspectable and low-cost; not a shared experiment server or immutable signed audit store. |
| Group-disjoint authored screenshot pilot | Reproducible references without scraping or licence ambiguity; only eight families, insufficient for broad claims. |
| Direct vs staged vs bounded-repair lanes | Exposes orchestration trade-offs; changing fallback models confounds attribution. |
| SQL views instead of a new analytics vendor | Reproducible metrics and no new external data transfer; historical uninstrumented events cannot be recovered. |
| Temporal folds instead of random train/test split | Respects forecast-time information. Rolling one-day predictions assume previous actuals are available. |
| Ridge, boosting and seasonal-naive candidates | A simpler strong baseline can beat a complex model. No algorithm prestige claim. |
| Lexical retrieval plus extractive evidence | Fully inspectable and runnable offline; not multilingual semantic search or a general reasoning assistant. |

## Remaining product boundaries

These portfolio additions do not claim to implement every aspirational item in the root specification. Full account recovery, multi-tenant cloud scaling, automatic retention/deletion, broader design/PDF/ZIP ingestion, multi-state reconstruction and real-user accessibility testing need separate implementation/validation. Existing supported image/video/paste, component tree, preview/compare, inspector, history and export functionality is preserved.
