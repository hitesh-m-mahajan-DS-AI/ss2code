# Running Screenshot-to-Code Studio

## Local development

For copy/paste commands, VS Code launch/tasks, the first screenshot-to-export walkthrough and troubleshooting, see [LOCAL_SETUP.md](./LOCAL_SETUP.md).

Use Node.js 24 LTS (minimum 22.13). Install dependencies and the browser:

    npm ci
    npx playwright install chromium

Copy .env.example to .env.local and set OPENROUTER_API_KEY. No direct provider key is used. Run npm run dev to start both Next.js and the durable generation worker. Open http://localhost:3000.

The model catalog is public, so it can load before a key is configured. Actual inference requires the server key. Free routes are checked against the live catalog, including ancillary prices; missing price/capability data is ineligible. Requests also set a zero-price ceiling. Availability and rate limits remain outside the app's control.

## Production on one host

This implementation uses SQLite WAL and a private local object directory. Run web and worker processes on the **same host with the same private volume**, outside the public web root. It is not designed for an ephemeral serverless filesystem, network-shared SQLite, or independent multi-host replicas. Back up the SQLite database using SQLite's backup API and back up the asset/preview directory together.

1. Run npm ci, including development dependencies used by the build worker.
2. Build the render image: docker build -f Dockerfile.render -t ss2code-render:local .
3. Configure OPENROUTER_API_KEY, a random SESSION_SECRET, an absolute PRIVATE_STORAGE_ROOT, and SANDBOX_MODE=docker.
4. Run npm run build, then npm start. Use a process supervisor to restart it after host/process failure. Alternatively supervise next start and npm run worker separately, both with NODE_ENV=production.
5. Serve through HTTPS. Preserve streaming responses and disable reverse-proxy buffering for the events endpoint.

Production rendering fails closed without Docker mode. Each render container has no network, a read-only filesystem, dropped capabilities, no secrets or host data mounts, a disposable temporary filesystem, a memory/CPU/process budget and a 180-second deadline. Development React rendering uses a separate process and the Chromium sandbox. Next.js generated server builds require the container even during development.

The worker polls the persistent queue, leases jobs for 30 seconds, renews every five seconds, and allows up to three crash recoveries within a 30-minute job deadline. Successful schema-validated model responses are checkpointed. A crash may repeat an in-flight provider request, but immutable publication is deduplicated by job ID. Cancellation aborts provider/render work on the next heartbeat and cannot publish a new revision after cancellation. Retrying a failed job creates a new job and preserves prior ready revisions.

Anonymous workspace ownership is protected by a signed, HttpOnly cookie. It is not an account system: clearing that cookie loses access to that workspace. Keep the session secret stable. The deployment must provide its normal access controls and storage backups; multi-user account management is a separate extension.

## Exports and validation

Ready revisions contain a screenshot, a self-contained interactive preview, a diff image, the source manifest, the component plan and model audit. The preview runs with scripts permitted but no same-origin privileges, network, popups or form submission. The inspector can select only known region IDs; messages from other frames are ignored.

Exports contain trusted React or Next.js configuration, pinned dependencies, a full lockfile, source files and run instructions. Reference images and keys are not included. The React export uses an esbuild/Tailwind static build and a small local server. Run npm ci --ignore-scripts followed by npm run dev. Rebuild after source edits. The Next.js export uses the standard Next.js development/build commands.

After changing toolchain dependencies, run npm run export:locks and commit both lock templates. Export creation rejects a stale lock template. Validation and export use the same scaffold, installed dependency versions and CSS compilation.

Read the displayed score as **pixel agreement**, not a guarantee. Regional geometry and visible-text coverage are measured against the approved Visual Spec. The renderer waits for fonts/images and matching captures, checks runtime exceptions, runs axe, and checks overflow at reference, tablet and mobile widths. Unseen responsive behavior and interactions still require human review. Final source and model reviews cannot override failed deterministic gates.

## Verification

- npm test: source security, free-model eligibility, retries/schema failure, streaming response parsing, queue idempotency/lease recovery/fencing, regional comparisons and real compilation/rendering.
- npm run test:e2e: launches an isolated studio and worker, creates explicit deterministic test revisions, exercises browser recovery/history/inspector/mobile controls, downloads a ZIP, installs and builds that ZIP independently, and checks authorization and failure recovery. It does not pretend to test live AI quality.
- npm run typecheck, npm run lint, npm run build.
- GitHub Actions repeats verification with the Docker renderer and saves desktop/mobile captures.

As of 2026-10-02, React process rendering and the complete browser/export flow are tested locally. A configured OpenRouter key enabled limited free-only live measurements; screenshot attempts exposed provider/schema/refinement failures, while one document evidence query succeeded. See [portfolio/EVIDENCE.md](./portfolio/EVIDENCE.md), rather than treating these as broad AI-quality validation. The local Docker daemon remains unavailable; container execution needs verification in CI or the configured deployment.

The portfolio extension adds local operational telemetry, benchmark artifacts, a SQL dashboard, forecasting and document retrieval. See [portfolio/OPERATIONS.md](./portfolio/OPERATIONS.md) for privacy, failure response and the backup/restore procedure.
