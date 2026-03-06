# Deploy To DigitalOcean (App Platform)

## What is already productionized

- App is served from Fastify in `backend/index.js`.
- React build is generated during Docker image build.
- Runtime listens on `PORT` and binds to `0.0.0.0`.
- Health endpoint is available at `/health`.
- SQLite paths are absolute from project structure (safe in container runtime).

## Deploy From DigitalOcean UI

1. Push this repo to GitHub.
2. In DigitalOcean: `Create` -> `Apps`.
3. Select your repo/branch.
4. Choose Dockerfile-based deploy (auto-detected from root `Dockerfile`).
5. Confirm service HTTP port is `8080`.
6. Add/confirm runtime env vars:
   - `NODE_ENV=production`
   - `REBUILD_FTS_ON_START=false`
7. Deploy.

## Deploy With doctl (optional)

Use the app spec file at `.do/app.yaml`:

```bash
doctl apps create --spec .do/app.yaml
```

If you already have an app, update it:

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

## Notes

- The project ships SQLite databases from `resources/db`. Keep these files in the repo for deploys.
- Set `REBUILD_FTS_ON_START=true` only when you intentionally want to rebuild the full FTS index at boot.
