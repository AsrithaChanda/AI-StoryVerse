# StoryVerse deployment: PostgreSQL, assets, and Databricks

StoryVerse has two storage modes:

| Environment | Transactional data | Generated images and narration |
| --- | --- | --- |
| Local development | SQLite when no PostgreSQL configuration is present, or the Docker Compose PostgreSQL service | `data/` on local disk |
| Container production | PostgreSQL (`DATABASE_URL` or standard `PG*` variables) | Persistent mounted disk only when `STORYVERSE_ASSET_STORAGE=local` |
| Databricks production | Lakebase PostgreSQL | Unity Catalog Volume through the Databricks Files API |

PostgreSQL is the canonical source for worlds, chapters, perspectives, queued directions, timeline rollbacks, and generated-asset metadata. The asset store holds image and narration bytes; database rows retain their stable asset identity and URL. This split makes concurrent request handling and branch-heavy story data safer while keeping binary media out of database tables.

## Environment contract

Copy [`.env.example`](../.env.example) to `.env` for local work. Do not commit `.env`.

| Variable | Required when | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL is used | Full PostgreSQL URI; takes precedence over individual `PG*` variables. |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE` | When a deployment injects standard PostgreSQL settings instead of a URI | Lakebase-compatible PostgreSQL connection inputs. `PGPASSWORD` must arrive through a secret for the current Node `pg` production path. |
| `PGSSL_REJECT_UNAUTHORIZED` | PostgreSQL TLS | Keep `true` in production; only set `false` for an intentionally trusted local test certificate. |
| `STORYVERSE_PG_POOL_MAX`, `STORYVERSE_PG_IDLE_TIMEOUT_MS`, `STORYVERSE_PG_CONNECT_TIMEOUT_MS` | PostgreSQL | Per-app-instance pool and connection timeouts. Start with the supplied conservative values, then tune after observing concurrency and Lakebase limits. |
| `STORYVERSE_ASSET_STORAGE` | Always | `local` or `databricks-volume`. |
| `DATABRICKS_HOST` | `databricks-volume` | Full Databricks workspace URL, such as `https://<workspace-host>`. |
| `DATABRICKS_TOKEN` | `databricks-volume` | Bearer token used by the Databricks Files API. Use a managed secret, never source control. |
| `DATABRICKS_VOLUME_PATH` | `databricks-volume` | `/Volumes/<catalog>/<schema>/<volume>/storyverse`; StoryVerse creates media beneath this root. |
| `OPENAI_API_KEY` | Live world, chapter, perspective, image, or narration generation | Server-only OpenAI credential. The app still starts without it, but live generation falls back or is unavailable as appropriate. |
| `PORT` | Local/Docker | HTTP port. Databricks Apps supplies the Express `PORT` at runtime. |

For Lakebase, use `PGSSLMODE=require`. Do not use the development PostgreSQL password from `docker-compose.yml` outside a local machine.

## Local testing

### Fast local fallback: SQLite and files

This remains useful for unit tests and offline UI work.

```bash
npm ci
cp .env.example .env
npm run dev
```

Leave `DATABASE_URL` empty and retain `STORYVERSE_ASSET_STORAGE=local`. The server creates `data/storyverse.db` and local media folders as needed.

### Concurrent-storage path: Docker Compose PostgreSQL

The repository includes a local-only PostgreSQL 16 environment and a production-mode application container.

```bash
cp .env.example .env
# Optionally add OPENAI_API_KEY to .env for live generation.
docker compose up --build
```

Then verify the service and PostgreSQL-backed health response:

```bash
curl --fail --silent http://127.0.0.1:8787/api/health
```

Open `http://127.0.0.1:8787`, create a world, generate a chapter, refresh the browser, and reopen the world. Generate at least one image and narration asset if an OpenAI key is configured. Recreate the application container with `docker compose up --build` and confirm the world and generated media remain visible.

Run the release checks outside or before the container build:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Stop the stack without deleting its volumes:

```bash
docker compose down
```

`docker compose down -v` deletes the local PostgreSQL and asset volumes. Only use it when deliberately resetting the local environment.

## Docker deployment

[`Dockerfile`](../Dockerfile) performs `npm ci` and `npm run build`, then serves the built client and API with `npm run start`. It deliberately keeps the runtime dependency tree because the present server start script uses `tsx`.

For a non-Databricks production platform:

1. Build the image from a clean source tree; `.env` and `data/` are excluded by [`.dockerignore`](../.dockerignore).
2. Provide a managed PostgreSQL connection through `DATABASE_URL` or `PG*`; enable TLS in the provider configuration.
3. Set `STORYVERSE_ASSET_STORAGE=databricks-volume` only after the three Databricks asset variables are present. Otherwise use a durable mounted disk with `local`.
4. Store `OPENAI_API_KEY` and `DATABRICKS_TOKEN` in that platform's secret manager.
5. Start at least two application replicas only after the database migration/initialization path has completed successfully; all replicas must point to the same PostgreSQL database and asset backend.
6. Smoke-test `/api/health`, world creation, a chapter generation, a character POV, image retrieval, narration retrieval, timeline rollback, and a page refresh.

The app must listen on `0.0.0.0` in a container; the runtime honors `PORT`.

## Databricks production: Apps + Lakebase + Unity Catalog Volume

Use a **Lakebase Autoscaling** project for a new deployment. Lakebase is managed PostgreSQL intended for low-latency application data. New Lakebase Provisioned databases are no longer the recommended new-project path. See [Lakebase resources for Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase).

### Database authentication decision

The current StoryVerse PostgreSQL adapter is a standard Node `pg` client. Its supported production path is a **native Lakebase PostgreSQL role/password** held in a managed secret and supplied as `PGPASSWORD` (or within a secret `DATABASE_URL`) with `PGSSLMODE=require`.

Databricks Apps can also attach a Lakebase resource and inject `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGSSLMODE`. That resource uses a Databricks identity whose OAuth database credential expires about hourly. StoryVerse does **not** yet implement the Apps-specific credential-generation/rotation loop, so attaching that resource by itself is **not a working production database credential path** for this version. Treat automated App-service-principal OAuth rotation as a follow-up before changing to it. A copied `DATABRICKS_OAUTH_TOKEN` can help a short-lived local connectivity experiment only; it is not a production secret strategy.

### Required workspace preparation

These are workspace-admin or data-owner actions; they cannot be completed only from this repository.

1. In the Databricks UI, create a Lakebase Autoscaling project, choose its production branch/database, and keep its connection details private.
2. Create a dedicated **native PostgreSQL role/password** for the production application using the Lakebase connection/role-management workflow. Store the password (or a complete `DATABASE_URL`) in a managed secret. The role needs `CONNECT` plus sufficient schema `USAGE`/`CREATE` and table privileges for StoryVerse's first-run migrations and normal CRUD. Do not use a personal copied OAuth token as this production password.
3. In Catalog Explorer, create a **managed Unity Catalog Volume** for StoryVerse media. Choose a path such as:

   ```text
   /Volumes/<catalog>/<schema>/storyverse_assets/storyverse
   ```

   StoryVerse uses it only for non-tabular image and narration files. Lakebase remains the transactional store.
4. Create a Databricks App from this repository's Git source or workspace folder. Attach the UC Volume resource with **Can read and write**. Adding a Lakebase App resource is optional until OAuth credential rotation is added to StoryVerse; it is not the native-password path described above.
5. Add secrets for `PGPASSWORD` (or `DATABASE_URL`), `OPENAI_API_KEY`, and `DATABRICKS_TOKEN` in a secret scope or your workspace's approved secret mechanism. Configure them as managed App values rather than literal text in `app.yaml`.
6. Give the App service principal access to the configured resources. The UC volume requires `USE CATALOG`, `USE SCHEMA`, `READ VOLUME`, and `WRITE VOLUME`; adding it as a Databricks Apps resource can grant the required access when the deployer has the needed management privileges. See [UC Volume resources for Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/uc-volumes).

`DATABRICKS_TOKEN` is a Files API bearer token. It may be a PAT or OAuth access token, but it must be issued and managed according to workspace policy and have the access above. This integration does **not** claim to exchange the Databricks App service principal credentials for a token automatically; coordinate the issuance/rotation path with the workspace administrator.

### App configuration

Use the Apps UI to add the resources and secret values, then set these non-secret environment values in the app configuration:

```text
STORYVERSE_ASSET_STORAGE=databricks-volume
DATABRICKS_HOST=https://<workspace-host>
DATABRICKS_VOLUME_PATH=/Volumes/<catalog>/<schema>/storyverse_assets/storyverse
OPENAI_MODEL=gpt-5.6-luna
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_NARRATION_MODEL=gpt-4o-mini-tts
```

For the current native-role database path, add these non-secret values from Lakebase:

```text
PGHOST=<lakebase-host>
PGPORT=5432
PGDATABASE=<lakebase-database>
PGUSER=<native-postgres-role>
PGSSLMODE=require
PGSSL_REJECT_UNAUTHORIZED=true
```

Set `PGPASSWORD` as a managed secret. Alternatively, set a complete TLS-enabled `DATABASE_URL` as a managed secret. `DATABASE_URL` takes precedence over all individual `PG*` values. Avoid putting `NODE_ENV=production` in the Apps environment unless all build-time dependencies have been moved from `devDependencies` to `dependencies`—Databricks runs the package `build` script during deployment.

Databricks Apps recognizes `package.json`, installs Node dependencies, runs `npm run build` when a build script exists, and then starts an npm app with `npm run start`. This project therefore builds the Vite client before its Express server starts. [Databricks Apps deployment lifecycle](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy)

The `app.yaml` file, if your workspace uses one, belongs at the repository root and should only set non-secret values directly. Reference App resources/secrets with `valueFrom`, not plaintext values. Databricks documents the `command` and `env` configuration model in [Configure Databricks app execution](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime).

### Production verification checklist

After the App reports healthy, verify through the deployed URL and the Apps logs:

- [ ] `GET /api/health` identifies PostgreSQL rather than SQLite and reports success without exposing a connection string or secret.
- [ ] Creating a world persists it after an App restart/redeploy.
- [ ] A generated chapter, character POV, direction queue, revision, and timeline prune remain correct after refresh.
- [ ] New image and narration assets appear under the selected Volume path and are served through StoryVerse’s API routes.
- [ ] Existing cached media loads without triggering a second model request.
- [ ] The App service principal can read/write only the designated Volume, and the database role has only the privileges StoryVerse requires.
- [ ] OpenAI and Databricks tokens never appear in browser code, client API responses, source control, or request logs.
- [ ] A token-expiry or Files API permission failure returns a clear fallback/error state without corrupting the saved story.
- [ ] A second concurrent browser session can create/update separate worlds without lost updates; inspect database/app logs for transaction or optimistic-concurrency errors.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App starts but `GET /api/health` says SQLite | Confirm `DATABASE_URL` or complete `PG*` settings reached the runtime and that PostgreSQL is reachable. |
| Lakebase authentication fails | Verify `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, secret `PGPASSWORD`, and `PGSSLMODE=require`. Do not assume an attached App database resource alone supplies a password for the current Node adapter. |
| Media requests fail with `403` or `404` | Check `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, exact `/Volumes/...` path, and the App identity's UC volume privileges. |
| Databricks deployment does not build the client | Ensure `package.json` and the `build` script are committed at the app root; do not set an environment that skips build dependencies. |
| Media is regenerated after redeploy | Confirm the database and the Volume path are both persistent and unchanged; do not switch asset backends for an existing production world without an asset migration. |
| Docker data disappears | Use `docker compose down`, not `docker compose down -v`, and retain the named Docker volumes. |

## Security and lifecycle notes

- Keep distinct development, staging, and production Lakebase branches/databases and Volume roots. Do not point test deployments at production data.
- Back up/retain PostgreSQL according to your Lakebase policy. Treat generated media as recoverable cache only after confirming the canonical metadata and generator inputs are durable.
- Do not expose a Volume URI or database credential directly to the browser; browser media should continue to flow through the StoryVerse API.
- Before rotating `DATABRICKS_TOKEN` or `OPENAI_API_KEY`, install the replacement secret, redeploy/restart one replica, validate asset generation, then revoke the old credential.
