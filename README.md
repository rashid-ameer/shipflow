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

If the shared tunnel is unavailable, run a separate temporary connector on ShipFlow's port. An empty connector configuration keeps the temporary hostname independent of the shared ingress rules.

```sh
shipflow_tunnel_config=$(mktemp)
printf '{}\n' > "$shipflow_tunnel_config"
cloudflared tunnel --config "$shipflow_tunnel_config" --protocol http2 --url http://127.0.0.1:13114
```

In another terminal, replace the example URL with the HTTPS URL printed by Cloudflare. The `default` Docker context selects Docker Engine when ShipFlow's database is stored there.

```sh
DOCKER_CONTEXT=default APP_PORT=13114 SHOPIFY_APP_URL=https://YOUR-TUNNEL.trycloudflare.com npm run preview
```

Use the Shopify Admin preview link printed by the CLI.

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

### Verify cart and product pricing

Create a cart-total rate with two tiers in this order. Set the first tier to 50 through 100 with a 10 rate. Set the second to 100 through unlimited (`~`) with an 18 rate. In Simulator, carts at 99.99, 100, and 100.01 should return 10, 10, and 18.

For a per-kg product rate, set a base of 4, an increment of 5 per kg, and skip the first kg. A matching 4 kg shipment starts at 19. A 10% discount brings it to 17.10, then handling of 2 and insurance of 1 bring it to 20.10. A maximum of 18.25 caps it at 18.25 before Settings rounding. The same pricing steps appear in Simulator and History.

Percentage rates use the applicable merchandise total. Product rates can combine matching lines, group them by a filter value, or price each line separately. Cart pricing uses the total before discounts by default. To test after-discount pricing, choose that basis in Settings and enter the discount in Simulator.

Run `npm run test:m6` with the local PostgreSQL connection to check the acceptance examples and confirm that saved rates, Simulator, and carrier requests agree. A live checkout needs a CCS-enabled test store.

### Verify combined shipping rates

1. Tag two scenario rates priced at $5 and $8 with `cake` and `candle`. Add a third rate without either tag.
2. In **Rates → Combined shipping rates**, create a **Sum** rule requiring both tags. In Simulator, select the scenarios and rule if they are still drafts. The original tagged rates should appear in the calculation breakdown and be replaced by a $13 option at checkout. The unrelated option should remain available.
3. Remove the `candle` tag and repeat. The $13 option should disappear and the individual rates should return. For a live test, use a CCS-enabled development store with ShipFlow configured in its shipping profile.

Rules run in the order shown by **Rule order**. Excluded rates count toward tag presence and stay available as separate options. A tagged output can be used by a later rule. ShipFlow applies the store's multiple-rate selection and rounding after the combinations.

Run `npm run test:m7` with the local PostgreSQL connection to verify rule ordering, tenant isolation, and parity between Simulator and the carrier callback.

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

### Product dimensions and package pricing

Open **Products** to sync up to 60,000 products. ShipFlow refreshes the catalog daily while automatic sync is enabled and applies product changes delivered by Shopify. The catalog worker runs with the application server and resumes queued work after a restart.

Use a product’s **Edit** action to save each variant’s length, width, and height. **Sync metafields** can use product or variant metafields. Shopify dimension metafields supply their own units. Numeric metafields use the shop’s configured dimension unit at the time of sync.

Under **Import product dimensions**, use **Send CSV** to receive the template by email. The file uses `product_id,variant_id,length,width,height,unit`. Blank cells preserve saved dimensions. ShipFlow lists invalid rows and emails the import summary. Set `RESEND_API_KEY` and `SHIPFLOW_EMAIL_FROM` to enable email delivery. The sender must use a domain verified with Resend.

In a fixed shipping rate, choose **Based on package** and set up cart-attribute or dimension-based packing. Simulator and History show each selected package and its quantity. Cart volume sums the physical units in the cart. Cart length, width, and height are the largest corresponding item dimensions. Volumetric weight uses cubic centimeters divided by the shop’s divisor. A missing required measurement prevents the affected rate from quoting.

Run `npm run test:m8` with the local PostgreSQL connection. The acceptance fixture imports a 40 × 30 × 20 cm variant, calculates 4.8 kg per unit and 9.6 kg for two units, and verifies a $7 carton in the Simulator pricing path and signed carrier callback.

### Live carrier rates

Set `SHIPFLOW_CARRIER_KEY` to a 32-byte hex key generated with `openssl rand -hex 32` and run the database migrations. Keep the key stable across app instances and restarts. Replacing it requires reconnecting UPS.

In CCS Rates mode, open **Settings → Carriers**. Connect a UPS account and provide an origin and destination to test Rating access. Use **Test another route** to discover services for the other route type. In **Rates → Scenarios**, choose **Live carriers**, configure packaging and any fallback, and test the rate in Simulator. Choose a Shopify fulfillment location with a postal code when the rate uses the Shopify origin. Sandbox connections work in Simulator and Test Mode. Use a production connection for live checkout.

UPS is the first implemented provider. The other listed carriers remain unavailable pending adapter work and contract verification. Shipping prices must be returned in the checkout currency. An empty service selection allows all returned services for that route type.

Run `npm run test:m9` against a migrated local PostgreSQL database to verify the quote and fallback with mocked UPS responses.

### Checkout settings and release rehearsal

**Settings** has eight tabs in CCS Rates mode. In **Shipping configuration**, set the cart total basis, UK postcode wildcards, manual rate codes, and the last-resort store fallback. An existing rate code is used only while manual codes are enabled. The duplicate flat rates setting merges identical options within a ShipFlow response. For one charge across separately quoted fulfillment locations, use Shopify's native flat-rate setup and check the store's location groups.

**Appearance** controls delivery estimates for fixed and combined rates. Estimates count days from the shop's calendar and skip the excluded weekdays. Enable precise dates to send a date range and show it in the selected format. **Integrations → Google Maps** tests and stores a Routes API key using `SHIPFLOW_CARRIER_KEY`. Driving distance is calculated only for matching carts that need it. In Simulator, select a fulfillment origin and supply a destination postal code.

For a release rehearsal, record the app image or Git revision, both Function builds, and the last released Shopify app version. Back up PostgreSQL and apply migrations to a staging copy before starting the updated app. Verify health, background catalog sync, signed webhooks, and the following journeys. Record the store's mode, CCS and market readiness, test identity, input, expected result, observed result, and History request ID where applicable.

| Journey | Local evidence | Live acceptance |
| --- | --- | --- |
| J1 · Delivery Customization | Onboarding persistence, rule activation and WebAssembly fixtures for tagged pickup | Fresh install and visible change at checkout |
| J2 · First CCS rate | Signed callback and Simulator fixtures cover Test Mode, Go Live and an eligible flat rate | CCS-enabled market, Test Mode checkout, then ordinary checkout |
| J3 · Free shipping | $90 → $8; $120 → $0; $120 less $25 → $8 with discounted totals enabled | Confirm the same prices in checkout |
| J4 · Combined rates | $5 + $8 → $13; removing a required tag restores the source options | Confirm one combined option at checkout |
| J5 · Carrier quotes | UPS mock returns $14; simulated outage returns $11.50 and a History error | Connected UPS account with Rating access and a real quote |
| J6 · Missing rates | UK postcode, unavailable Maps, no match, disabled app, and History isolation | Confirm the affected checkout request is visible in History |
| J7 · Mode switching | Runtime and persistence fixtures cover failure recovery and reactivation of saved rules | Cancel once, switch to CCS, then switch back and confirm the saved customization |
| J8 · Dimensions | 4.8 kg volumetric weight per item, $7 carton, and missing-dimensions handling | Sync a real variant and compare against checkout |

The local release suite is `npm run test:m10`. The public development preview returned HTTP 502 during the rehearsal. Live market configuration, the embedded screen walkthrough, and both live checkout journeys remain release gates. UPS is the implemented carrier. Other provider contracts and live Maps quotes remain unverified.

To roll back, restore the prior app server artifact and its environment, and release the previously recorded Shopify app version if the extensions changed. Keep the additive migration in place for the prior app version. Restore the database backup only if needed for data recovery, after accounting for writes made after the backup. Verify health, a signed rate request and History, and the active delivery customization before calling the rollback complete.
