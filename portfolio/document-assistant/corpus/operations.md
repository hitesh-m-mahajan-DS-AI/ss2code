# Isolation and recovery

Production rendering requires SANDBOX_MODE=docker and a prepared ss2code-render:local image. Containers have no network access, restricted capabilities and resource budgets. A local development child process is not equivalent to container isolation. Docker Desktop must have a running Linux engine; a CLI installation alone is insufficient.

Jobs are stored in SQLite on the same host as the worker. The worker renews a 30-second lease every five seconds. Failed jobs may be retried without replacing earlier ready revisions. Private references and revisions are stored in .data/private by default. Do not delete this directory as a cache fix. Clearing the signed ownership cookie can lose access to anonymous projects.
