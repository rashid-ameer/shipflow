import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import prisma from "../app/db.server";
import type { ScenarioDraft } from "../app/models/calculated-rates";
import {
  action as save,
  loader as loadEditor,
} from "../app/routes/app.rates.scenario";
import type { AdminQuery } from "../app/models/delivery-customization-admin.server";
import {
  completeOnboarding,
  OperatingMode,
} from "../app/models/shop-settings.server";
import SimulatorPage, { action, loader } from "../app/routes/app.simulator";
import { authenticate } from "../app/shopify.server";

const shop = `simulator-scenario-${randomUUID()}.myshopify.com`;
const url = new URL("https://example.com/app/simulator");
const variantId = "gid://shopify/ProductVariant/101";
const originalAdmin = Object.getOwnPropertyDescriptor(authenticate, "admin");

const graphql: AdminQuery = async (operation, options) => {
  if (operation.includes("currencyCode")) {
    return Response.json({
      data: {
        shop: {
          currencyCode: "USD",
          shopAddress: { countryCodeV2: "US" },
        },
      },
    });
  }
  if (operation.includes("ShipFlowSimulatorLocations")) {
    return Response.json({
      data: {
        locations: {
          nodes: [],
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      },
    });
  }
  if (operation.includes("ShipFlowSimulatorVariants")) {
    const ids = (options?.variables?.ids ?? []) as string[];
    const variant = {
      id: variantId,
      title: "Default Title",
      price: "10.00",
      sku: "SIM-1",
      product: {
        title: "Simulator box",
        vendor: "Acme",
        isGiftCard: false,
      },
      inventoryItem: {
        requiresShipping: true,
        measurement: { weight: { value: 1, unit: "POUNDS" } },
      },
    };
    return Response.json({
      data: { nodes: ids.map((id) => (id === variantId ? variant : null)) },
    });
  }
  throw new Error(`Unexpected GraphQL operation: ${operation}`);
};

Object.defineProperty(authenticate, "admin", {
  configurable: true,
  value: async () => ({
    admin: { graphql },
    session: { shop, scope: "read_customers" },
  }),
});

function routeArgs(
  path: string,
  params: Record<string, string>,
  form?: FormData,
) {
  const target = new URL(path, url);
  return {
    url: target,
    request: new Request(target, form ? { method: "POST", body: form } : {}),
    pattern: path,
    params,
    context: {},
  };
}

async function persist(draft: ScenarioDraft, id = "new", revision?: string) {
  const form = new FormData();
  form.set("draft", JSON.stringify(draft));
  form.set("currency", "USD");
  if (revision) form.set("revision", revision);
  const saved = await save(
    routeArgs(`/app/rates/scenarios/${id}`, { id }, form),
  );
  if (!("id" in saved))
    assert.fail(`Saving ${draft.name}: ${saved.data.error}`);
  return saved;
}

async function simulate(
  country: string,
  quantity: number,
  selected: string[] = [],
  testIdentity = true,
) {
  const form = new FormData();
  form.set("intent", "run");
  form.set(
    "items",
    JSON.stringify([{ id: variantId, quantity: String(quantity) }]),
  );
  form.set("country", country);
  form.set("testIdentity", testIdentity ? "yes" : "no");
  form.set("includeCombined", "yes");
  for (const id of selected) form.append("scenario", id);
  const outcome = await action(routeArgs(url.pathname, {}, form));
  if (!("kind" in outcome)) assert.fail(outcome.data.message);
  assert.equal(outcome.kind, "result");
  return outcome.result;
}

try {
  await completeOnboarding(shop, OperatingMode.CCS_RATES);
  const editor = await loadEditor(
    routeArgs("/app/rates/scenarios/new", { id: "new" }),
  );
  assert.equal(editor.currency, "USD");
  const domestic = editor.regions.find((region) => region.kind === "DOMESTIC");
  const rest = editor.regions.find((region) => region.kind === "REST");
  assert.ok(
    domestic && rest,
    "The first visit to Create scenario must show both default regions.",
  );

  function makeDraft(
    name: string,
    price: string,
    regionId: string,
    conditions: ScenarioDraft["conditions"],
    active = true,
  ): ScenarioDraft {
    return {
      name,
      active,
      conditions,
      rates: [{ id: randomUUID(), name, price, regionId, description: "" }],
    };
  }

  const standard = makeDraft("US standard", "7.50", domestic.id, [
    { field: "cartTotal", operator: "lt", value: "100" },
  ]);
  const free = makeDraft("US free shipping", "0", domestic.id, [
    { field: "cartTotal", operator: "gte", value: "100" },
  ]);
  const bulk = makeDraft("US bulk freight", "18", domestic.id, [
    { field: "cartQuantity", operator: "gte", value: "5" },
    { field: "cartWeight", operator: "gte", value: "4", weightUnit: "lb" },
  ]);
  const canada = makeDraft("Canada delivery", "15", rest.id, [
    { field: "country", operator: "eq", value: "CA" },
  ]);
  const express = makeDraft(
    "US express preview",
    "22",
    domestic.id,
    [{ field: "country", operator: "eq", value: "US" }],
    false,
  );
  const drafts = [standard, free, bulk, canada, express];
  const preview = await persist(express);
  await prisma.store.update({
    where: { shopDomain: shop },
    data: { testMode: false },
  });
  const disconnected = await simulate("US", 1, [preview.id], false);
  assert.deepEqual(
    disconnected.rates.map((r) => [r.service_name, r.total_price]),
    [["US express preview", "2200"]],
  );
  await prisma.store.update({
    where: { shopDomain: shop },
    data: {
      testMode: true,
      ccsStatus: "ENABLED",
      carrierServiceId: "gid://shopify/DeliveryCarrierService/101",
    },
  });
  const saved = [
    await persist(standard),
    await persist(free),
    await persist(bulk),
    await persist(canada),
    preview,
  ];
  const freeShipping = saved[1];

  const loaded = await loader(routeArgs(url.pathname, {}));
  assert.ok(loaded.ccs);
  const router = createMemoryRouter(
    [{ path: url.pathname, id: "simulator", Component: SimulatorPage, loader }],
    {
      initialEntries: [url.pathname],
      hydrationData: { loaderData: { simulator: loaded } },
    },
  );
  try {
    const markup = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );
    assert.equal(loaded.scenarios.length, drafts.length);
    for (const [index, draft] of drafts.entries()) {
      assert.deepEqual(
        loaded.scenarios.find(({ id }) => id === saved[index].id),
        {
          id: saved[index].id,
          name: draft.name,
          active: draft.active,
        },
      );
      const label = draft.active ? draft.name : `${draft.name} (inactive)`;
      assert.ok(
        markup.includes(`<s-checkbox label="${label}"`),
        `Missing scenario checkbox: ${label}`,
      );
    }
  } finally {
    router.dispose();
  }

  const cases = [
    { country: "US", quantity: 1, expected: { "US standard": "750" } },
    { country: "US", quantity: 4, expected: { "US standard": "750" } },
    {
      country: "US",
      quantity: 5,
      expected: { "US standard": "750", "US bulk freight": "1800" },
    },
    {
      country: "US",
      quantity: 9,
      expected: { "US standard": "750", "US bulk freight": "1800" },
    },
    {
      country: "US",
      quantity: 10,
      expected: { "US free shipping": "0", "US bulk freight": "1800" },
    },
    { country: "CA", quantity: 10, expected: { "Canada delivery": "1500" } },
    { country: "GB", quantity: 10, expected: {}, reason: "no-region-rate" },
    {
      country: "US",
      quantity: 1,
      selected: [preview.id],
      expected: { "US express preview": "2200" },
    },
    {
      country: "US",
      quantity: 10,
      selected: [freeShipping.id, preview.id],
      expected: { "US free shipping": "0", "US express preview": "2200" },
    },
    {
      country: "US",
      quantity: 1,
      selected: [freeShipping.id],
      expected: {},
      reason: "unmatched-conditions",
    },
  ];
  for (const { country, quantity, selected, expected, reason } of cases) {
    const result = await simulate(country, quantity, selected);
    const rates = result.rates.map((rate) => [
      rate.service_name,
      rate.total_price,
    ]);
    const context = `${country}, quantity ${quantity}, scenarios ${selected ?? "active"}`;
    assert.equal(result.reason, reason ?? "matched", context);
    assert.deepEqual(rates.sort(), Object.entries(expected).sort(), context);
  }
  const blocked = await simulate("US", 1, [], false);
  assert.equal(blocked.reason, "test-mode");
  assert.deepEqual(blocked.rates, []);

  // Activate the draft and change its price through the same action used by the editor.
  express.active = true;
  express.rates[0].price = "20";
  await persist(express, preview.id, preview.revision);
  const refreshed = await loader(routeArgs(url.pathname, {}));
  assert.ok(
    refreshed.ccs &&
      refreshed.scenarios.find(({ id }) => id === preview.id)?.active,
  );
  const updated = await simulate("US", 1);
  assert.deepEqual(
    updated.rates.map((r) => [r.service_name, r.total_price]).sort(),
    [
      ["US express preview", "2000"],
      ["US standard", "750"],
    ],
  );
  console.log(
    "Five saved scenarios rendered as simulator choices. All 13 simulation cases passed.",
  );
} finally {
  if (originalAdmin) {
    Object.defineProperty(authenticate, "admin", originalAdmin);
  } else {
    Reflect.deleteProperty(authenticate, "admin");
  }
  await prisma.store.deleteMany({ where: { shopDomain: shop } });
}
