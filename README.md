# ShipFlow

Docker Compose runs the embedded React Router app and PostgreSQL. Prisma applies the database migrations on startup. The app home is at `/app`, and `/health` reports HTTP readiness. Milestone 1 provides persisted onboarding, operating-mode selection, and the first dashboard.

## Connect a development store

1. From `shipflow/`, copy `.env.example` to `.env`. Set a random hexadecimal database password (for example, generate one with `openssl rand -hex 32`). Compose uses it in the database connection URL.
2. Create or select the **ShipFlow development app** in your Shopify Dev Dashboard. Put its client ID in `SHOPIFY_API_KEY` and its client secret in `SHOPIFY_API_SECRET` locally. Keep the secret in the ignored environment file.
3. Set up an HTTPS tunnel to local port 3000 and set `SHOPIFY_APP_URL` to its public origin. If port 3000 is occupied, set `APP_PORT` and point the tunnel at that port.
4. Set `client_id` in `shopify.app.toml` to the development app’s client ID. Its application and callback URLs use `https://d5.genieapps.xyz`. Keep `SCOPES` aligned with the app configuration as features are added.
5. Run the commands below. Once the local health endpoint responds, apply the TOML configuration to the intended development app using Shopify CLI (`shopify app deploy` from this directory after verifying the selected app). Install that app on your development store and open ShipFlow in Shopify Admin.

```sh
docker compose up --build -d --wait
curl -fsS http://localhost:3000/health
docker compose logs -f app
```

## Daily development

### Shopify CLI preview and install link

Shopify CLI runs the development web server and provides an install/preview link for a selected development store. Keep the Cloudflare tunnel forwarding `d5.genieapps.xyz` to local port 3000. Stop the Docker app before starting the CLI server because both use that port. PostgreSQL stays in Docker and is exposed only on local port 5433.

```sh
docker compose stop app
docker compose up -d db
set -a
source .env
set +a
export DATABASE_URL="postgresql://shipflow:${POSTGRES_PASSWORD}@127.0.0.1:5433/shipflow"
npx prisma migrate deploy
shopify app dev --tunnel-url=https://d5.genieapps.xyz:3000
```

Choose your development store when prompted and open the install/preview URL printed by Shopify CLI. The CLI also supplies Shopify app credentials to its development process. To return to the Docker app, stop CLI with Ctrl+C and run `docker compose up -d app`.

Docker uses Node 26.13.1 LTS and PostgreSQL 19. Compose stores database files in the `postgres19_data` volume.

Run `docker compose up --build -d --wait` after source changes. Run `docker compose exec app npm run typecheck` to check TypeScript. Use `docker compose down` to stop the services. The named PostgreSQL volume persists sessions across restarts. When the tunnel origin changes, update both the environment and Shopify URLs, then recreate the app container and apply the development app configuration again.

For the milestone persistence checks, keep PostgreSQL running, set `DATABASE_URL` to the local port `5433`, and run `npm run test:m1` and `npm run test:m2`. The tests remove their temporary shop records when finished.

## Inspect or reset local database data

For a visual editor, keep the database container running, export the local `DATABASE_URL` shown above, and run `npx prisma studio`. Prisma Studio opens locally and lets you inspect `Store`, `StoreSettings`, and `Session` records.

For SQL access:

```sh
docker compose exec db psql -U shipflow -d shipflow
```

Inside `psql`, use `\dt` to list tables. To reset one development shop, replace the example domain with the exact shop domain and run the targeted transaction below. `StoreSettings` is removed automatically with its `Store`; sessions are separate. This deletion is permanent, so inspect the matching rows or back up the database first.

```sql
BEGIN;
SELECT "shopDomain", "onboardingStep", "mode" FROM "Store"
WHERE "shopDomain" = 'example.myshopify.com';
DELETE FROM "Session" WHERE shop = 'example.myshopify.com';
DELETE FROM "Store" WHERE "shopDomain" = 'example.myshopify.com';
COMMIT;
```

[Implementation plan](../shipflow_docs/shipflow.milestones.md)
