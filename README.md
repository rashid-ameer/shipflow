# ShipFlow

Docker Compose runs the embedded React Router app and PostgreSQL. Prisma applies the database migrations on startup. The app home is at `/app`, and `/health` reports HTTP readiness. Milestone 1 provides persisted onboarding, operating-mode selection, and the first dashboard.

## Connect a development store

1. From `shipflow/`, copy `.env.example` to `.env`. Set a random hexadecimal database password (for example, generate one with `openssl rand -hex 32`). Compose uses it in the database connection URL.
2. Create or select the **ShipFlow development app** in your Shopify Dev Dashboard. Put its client ID in `SHOPIFY_API_KEY` and its client secret in `SHOPIFY_API_SECRET` locally. Keep the secret in the ignored environment file.
3. Route the named Cloudflare hostname `d5.genieapps.xyz` to `http://127.0.0.1:3013`. Set `SHOPIFY_APP_URL` and `APP_PORT` to match. Keep unrelated hostnames and their origin ports as configured.
4. Set `client_id` in `shopify.app.toml` to the development app’s client ID. Its application and callback URLs use `https://d5.genieapps.xyz`. Keep `SCOPES` aligned with the app configuration as features are added.
5. Run the commands below. Once the local health endpoint responds, apply the TOML configuration to the intended development app using Shopify CLI (`shopify app deploy` from this directory after verifying the selected app). Install that app on your development store and open ShipFlow in Shopify Admin.

```sh
docker compose up --build -d --wait
npm run preview:check -- http://127.0.0.1:3013
docker compose logs -f app
```

## Daily development

### Shopify CLI preview and install link

Keep the named Cloudflare connector running with `d5.genieapps.xyz` mapped to ShipFlow’s local `APP_PORT`. The default is 3013. If that port is occupied, set `APP_PORT` in `.env` and update the ShipFlow ingress rule to match. Restart a stopped connector in a separate terminal with `cloudflared tunnel --config ~/.cloudflared/config.yml run`. Use one ShipFlow preview process for the development store. PostgreSQL uses local port 5433.

```sh
npm run preview
```

Choose your development store when prompted. The command reuses the configured local PostgreSQL listener when available, applies migrations, and launches Shopify CLI on the fixed URL. When CLI reports ready, run `npm run preview:check` in a second terminal, then open its Shopify Admin preview link. A 502 from the check means the connector cannot reach the app on the configured local port. A response from a different app fails the check too.

Use this same command after a restart to keep the Shopify preview URL stable. To return to the Docker app, stop the CLI with Ctrl+C and run `docker compose up -d app`.

Docker uses Node 26.13.1 LTS and PostgreSQL 19. Compose stores database files in the `postgres19_data` volume.

Run `docker compose up --build -d --wait` after source changes. Run `docker compose exec app npm run typecheck` to check TypeScript. Use `docker compose down` to stop the services. The named PostgreSQL volume persists sessions across restarts. When the tunnel origin changes, update both the environment and Shopify URLs, then recreate the app container and apply the development app configuration again.

For the milestone persistence checks, keep PostgreSQL running, set `DATABASE_URL` to the local port `5433`, and run `npm run test:m1` through `npm run test:m4`. The tests remove their temporary shop records when finished.

### Test Delivery Customization

Run `npm run preview` on the selected development store to preview both Function extensions and grant the delivery customization scopes.

In ShipFlow, select Delivery Customization and create a Basic rule for Pickup in store. Add a Product tag condition and the Hide all rates IF action, then save as Active. Compare checkout for a product with that tag and one without it. Switch to CCS Rates and back to verify the rule pauses and resumes. Pickup must already be offered by Shopify for the test products.

Run the WebAssembly fixtures from the project root with `npm --workspace shipflow-delivery-customization run test -- --run` and `npm --workspace shipflow-delivery-advanced run test -- --run`.

### Test calculated shipping

1. Open ShipFlow on a development store with Carrier Calculated Shipping enabled, select CCS Rates, and choose **Rates → Connect Carrier Service**. Approve shipping access if Shopify prompts. If Shopify reports CCS is unavailable, use the link in the Rates banner to check eligibility before reconnecting.
2. Add **ShipFlow** as a carrier-calculated provider in the relevant Shopify shipping profile or market. Return to Rates and select **Refresh** to check setup.
3. Create a scenario with a Cart Total condition of at least 100 in the store currency. Add a fixed Domestic rate of 10 and save the scenario as Active. Domestic starts with the Shopify store address country and can be edited in **Manage regions**.
4. In Test Mode, compare carts totaling 99 and 100 before discounts using `shipflow` as the checkout first name. Compare with an ordinary name using a different cart or destination to avoid Shopify’s cached response. The Rates page shows whether Shopify supplied a name and how many rates the last request returned.

The callback returns no Test Mode rates when Shopify omits the name. Fixed prices use the store currency. A callback in a different currency needs a matching rate currency before ShipFlow can quote it. Keep the stable HTTPS URL online throughout checkout testing.

### Compare Simulator and checkout History

1. In **Simulator**, choose Shopify variants and quantities, then set the destination and origin. Run a cart totaling 99 and another totaling 100 against the scenario above. Active scenarios run by default. Explicitly select an inactive scenario to preview a draft before connecting CCS.
2. In **History**, open each request to compare the saved region, condition results, fixed price, and final price. History shows the last 30 days of actual Carrier Service requests, including empty quotes and failed requests.
3. If History shows no requests, check the Carrier Service and market or shipping profile setup in **Rates**. Simulator runs leave History unchanged.

Simulator uses the Shopify catalog price in the store currency. Optional customer selection and History name search use Shopify’s customer access. History records the region-level destination, cart inputs, and quote outcome. It looks up names from Shopify as needed. Shopify customer-data requests appear in History when matched checkout data exists.

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
