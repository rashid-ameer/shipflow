import assert from "node:assert/strict";

import {
  buildMarketReadiness,
  type MarketSnapshot,
  type ShippingConfigurationSnapshot,
} from "../app/models/market-readiness";
import { MARKET_READINESS_LIMITS } from "../app/models/market-readiness.server";

function shipping(
  callbackUrl: string,
  overrides: Partial<ShippingConfigurationSnapshot> = {},
): ShippingConfigurationSnapshot {
  return {
    isEnabled: true,
    optionDefinitions: {
      nodes: [
        {
          __typename: "DeliveryCarrierCalculatedOptionDefinition",
          isActive: true,
          rateGroups: {
            nodes: [
              {
                carrierService: { active: true, callbackUrl },
              },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

function market(
  id: string,
  name: string,
  marketShipping: ShippingConfigurationSnapshot | null,
  parentId?: string,
  status: MarketSnapshot["status"] = "ACTIVE",
): MarketSnapshot {
  return {
    id,
    name,
    status,
    parentMarkets: { nodes: parentId ? [{ id: parentId }] : [] },
    delivery: { shipping: marketShipping },
  };
}

const appUrl = "https://shipflow.example";
const shopDomain = "example.myshopify.com";

assert.deepEqual(
  MARKET_READINESS_LIMITS,
  { markets: 50, optionDefinitions: 25, rateGroups: 10 },
  "the dashboard query must stay below Shopify's single-query cost limit",
);

{
  const result = buildMarketReadiness(
    [market("1", "Canada", shipping(`${appUrl}/api/carrier/rates`))],
    shopDomain,
    appUrl,
  );
  assert.equal(result[0]?.ready, true, "active ShipFlow provider is ready");
}

{
  const result = buildMarketReadiness(
    [market("1", "Canada", shipping("https://another-app.example/rates"))],
    shopDomain,
    appUrl,
  );
  assert.equal(result[0]?.ready, false, "another provider is not ShipFlow");
}

{
  const parent = market("parent", "North America", shipping(`${appUrl}/rates`));
  const child = market("child", "Canada", null, parent.id);
  const result = buildMarketReadiness([parent, child], shopDomain, appUrl);
  assert.equal(
    result.find(({ id }) => id === child.id)?.ready,
    true,
    "a child inherits its parent's ShipFlow provider",
  );
}

{
  const parent = market("parent", "North America", shipping(`${appUrl}/rates`));
  const child = market(
    "child",
    "Canada",
    shipping(`${appUrl}/rates`, { isEnabled: false }),
    parent.id,
  );
  const result = buildMarketReadiness([parent, child], shopDomain, appUrl);
  assert.equal(
    result.find(({ id }) => id === child.id)?.ready,
    false,
    "a disabled child override does not inherit readiness",
  );
}

{
  const active = market("active", "United States", shipping(`${appUrl}/rates`));
  const draft = market(
    "draft",
    "Draft market",
    shipping(`${appUrl}/rates`),
    undefined,
    "DRAFT",
  );
  const result = buildMarketReadiness([draft, active], shopDomain, appUrl);
  assert.deepEqual(
    result.map(({ id }) => id),
    [active.id],
    "only active markets contribute to the merchant-facing count",
  );
  assert.equal(
    result[0]?.manageUrl,
    `https://${shopDomain}/admin/settings/markets`,
  );
}

{
  const cyclicA = market("a", "A", null, "b");
  const cyclicB = market("b", "B", null, "a");
  const result = buildMarketReadiness([cyclicA, cyclicB], shopDomain, appUrl);
  assert.ok(result.every(({ ready }) => !ready), "invalid cycles fail closed");
}

console.log("Market readiness verification passed (7 cases).");
