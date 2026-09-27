# Reliability implementation checklist

Authoritative contracts: `README.md` and `prompts.md`.

- [x] Complete trusted export scaffold, real type/lint/build checks, interactive isolated preview.
- [x] Stable captures, exact viewport, regional pixel/geometry/text evidence, diff images and regression fixtures.
- [x] Transactional persistent queue, leases/checkpoints, idempotency, cancellation, recovery and reconnect.
- [x] Live free-price/capability validation, bounded retries/fallbacks, model health and resolved-model audit.
- [x] Persisted component/file blueprint, hierarchical explorer, region-to-file inspection and file copy.
- [x] Working device/zoom/inspector/history/undo/redo controls and accessible mobile workspace.
- [x] Run automated failure and workflow tests, inspect desktop/mobile, document deployment.

Local verification: 13 automated tests; browser recovery, comparison, inspector, history, mobile controls, upload/video selection, authorization, failure recovery and independent ZIP install/build; TypeScript, ESLint and production build; zero reported dependency vulnerabilities. CI additionally exercises container-based React and Next.js builds. Live model quality requires an OpenRouter key; local Docker execution requires a working daemon. See DEPLOYMENT.md.
