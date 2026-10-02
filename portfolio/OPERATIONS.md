# Operations, security and release runbook

Updated 2026-10-02. See [DEPLOYMENT.md](../DEPLOYMENT.md) for the single-host production recipe and [LOCAL_SETUP.md](../LOCAL_SETUP.md) for VS Code.

## Local startup and verification

```powershell
npm ci
npx playwright install chromium
npm run dev
```

Configure `.env.local` from `.env.example`; never commit it. Only `OPENROUTER_API_KEY` is an inference credential. Open the studio at `http://localhost:3000`. `npm run dev` starts both web and durable worker processes. Stop both before replacing dependencies or moving the private volume.

Release checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, the benchmark self-test, document evaluation and Python unit tests. CI includes a separate Python job and Docker-backed Node verification. A configured workflow is not evidence that its remote run passed; inspect the actual GitHub run after pushing.

## Threat boundaries

- Treat generated source and uploaded references as untrusted. Process rendering is for private local development; public/untrusted production rendering requires the no-network Docker sandbox. Never expose a Docker control socket to generated code.
- Free pricing is checked against current catalog metadata and constrained to zero prompt/completion price. Never fix a quota failure by silently buying a paid route or adding a direct provider key.
- Keep the session secret stable and outside backups intended for sharing. The signed ownership cookie is not account recovery. Losing it can lose workspace access.
- `.data`, `.env.local`, raw corpora, model binaries, run candidates and telemetry must not enter public Git history. Public evidence is limited to authored examples and reviewed aggregate results.
- Telemetry opt-out is `TELEMETRY_ENABLED=false`; existing telemetry is not automatically deleted. Limit access and apply an explicit operator-managed retention policy. Automatic retention is not implemented.
- Forecast artifacts use executable joblib serialization; a matching hash does not make an unknown publisher safe. Document answers are source quotations, not trusted instructions.

## Failure response

| Symptom | Action |
| --- | --- |
| OpenRouter 429 / timeouts | Inspect safe telemetry and resolved route; wait for provider recovery or select another eligible free model. Preserve failures in reports. Do not loosen price/security gates. |
| Repeated schema errors | Inspect role/model metadata, capability and schema size. Specialist classifiers are excluded. Changes require a new versioned benchmark run. |
| Render/build rejection | Read private findings; repair within the file/dependency allowlist. Never bypass source policy to get a green score. |
| Optional visual repair failure | Retain the prior candidate and record the warning; required hard gates and final QA still apply. |
| Queue/process crash | Restart supervisor; leases and checkpoints recover bounded work. An in-flight provider request may repeat. Verify final immutable publication, not just process liveness. |
| Stale document index | Rebuild explicitly and review changed sources; do not answer from old hashes. |
| Forecast drift / interval undercoverage | Keep the run unpromoted, investigate labelled performance and collect a new validation period. No automatic retraining. |
| Suspected key exposure | Revoke/rotate the key in OpenRouter and replace the server secret; audit logs/backups without printing keys. |

## Backup and restore procedure

This is an operator procedure, not a claimed completed disaster-recovery exercise:

1. Stop web, worker and analytics writers, and verify no jobs are actively mutating storage. Record the release commit and effective configuration **without secrets**.
2. Create an access-restricted, dated backup outside the live private root. Use SQLite's backup API for `studio.sqlite` and `telemetry.sqlite`, then copy the associated asset/preview artifacts while writers remain stopped. Do not copy only a live WAL database file and omit its WAL state.
3. Store a manifest of file hashes. Protect encryption keys/session secrets separately; encrypt backups according to your deployment's policy.
4. Restore into a **new empty private directory**, never over the only live copy. Check hashes and run `PRAGMA integrity_check` on restored databases. Ensure revision assets resolve.
5. Point an isolated web/worker pair to the restored directory with an appropriate test port. Verify authorized access, preview, history, export and queue recovery. Record recovery time and data loss against your agreed RTO/RPO.
6. Switch live configuration only after approval and verification; retain the previous private root for rollback. Do not publish copied private artifacts as CI downloads.

No automatic backup service, off-host restore test, public deployment or production SLO has been demonstrated here. The local Docker daemon was unavailable during this release's checks; CI/deployment must exercise the container path before a production claim.
