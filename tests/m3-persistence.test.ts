import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../app/db.server";
import {
  emptyDeliveryRule,
  type DeliveryRule,
} from "../app/models/delivery-customization";
import type {
  AdminQuery,
  NativeDeliveryRule,
} from "../app/models/delivery-customization-admin.server";
import {
  changeDeliveryRuntime,
  getDeliveryRule,
  getDeliveryStatus,
  saveDeliveryRule,
} from "../app/models/delivery-customization.server";
import {
  completeOnboarding,
  getOrCreateShop,
  OperatingMode,
  switchOperatingMode,
  updateDeliverySettings,
} from "../app/models/shop-settings.server";

const suffix = randomUUID().slice(0, 12);
const shop = `m3-first-${suffix}.myshopify.com`;
const otherShop = `m3-other-${suffix}.myshopify.com`;
const id = randomUUID();
const pickupRule: DeliveryRule = {
  ...emptyDeliveryRule("kg"),
  name: "Hide pickup for tagged products",
  methods: ["PICK_UP"],
  conditions: [
    { field: "productTag", operator: "equals", value: "warehouse-only" },
  ],
  ifActions: [{ kind: "hide-all" }],
};
let failed = false;
let createTimedOut = false;
let partialActivate = false;
let capacity = 0;
const native: NativeDeliveryRule[] = [];
const fake: AdminQuery = async (query, options) => {
  const vars = options?.variables ?? {};
  if (query.includes("query ShipFlowDeliveryCustomizations")) {
    return Response.json({
      data: {
        deliveryCustomizations: {
          nodes: [
            ...native,
            ...Array.from({ length: capacity }, (_, index) => ({
              id: `other-${index}`,
              enabled: true,
              metafield: null,
            })),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  }
  if (query.includes("mutation ShipFlowActivateDeliveryCustomizations")) {
    const ids = vars.ids as string[];
    for (const row of native)
      if (ids.includes(row.id)) row.enabled = Boolean(vars.enabled);
    if (partialActivate) {
      partialActivate = false;
      return Response.json({
        data: {
          deliveryCustomizationActivation: {
            ids: [],
            userErrors: [{ message: "Temporary activation error" }],
          },
        },
      });
    }
    return Response.json({
      data: { deliveryCustomizationActivation: { ids, userErrors: [] } },
    });
  }
  const input = vars.customization as {
    enabled: boolean;
    metafields: [{ value: string }];
  };
  const update = query.includes("mutation ShipFlowUpdateDeliveryCustomization");
  const endpoint = update
    ? "deliveryCustomizationUpdate"
    : "deliveryCustomizationCreate";
  if (failed)
    return Response.json({
      data: {
        [endpoint]: {
          userErrors: [{ message: "Temporary publication error" }],
        },
      },
    });
  const value = JSON.parse(input.metafields[0].value);
  const next = {
    id: update
      ? String(vars.id)
      : `gid://shopify/DeliveryCustomization/${native.length + 1}`,
    enabled: input.enabled,
    metafield: { jsonValue: value },
  };
  if (update)
    native.splice(
      native.findIndex((item) => item.id === vars.id),
      1,
      next,
    );
  else native.push(next);
  if (createTimedOut) {
    createTimedOut = false;
    throw new Error("Simulated response loss after create");
  }
  return Response.json({
    data: { [endpoint]: { deliveryCustomization: next, userErrors: [] } },
  });
};
try {
  const first = await getOrCreateShop(shop);
  const second = await getOrCreateShop(otherShop);
  await completeOnboarding(shop, OperatingMode.DELIVERY_CUSTOMIZATION);
  await completeOnboarding(otherShop, OperatingMode.DELIVERY_CUSTOMIZATION);
  capacity = 25;
  await assert.rejects(
    () => saveDeliveryRule(fake, shop, id, "create", pickupRule, null),
    /25 active/,
  );
  assert.equal(await getDeliveryRule(first.id, id), null);
  capacity = 0;
  createTimedOut = true;
  await assert.rejects(
    () => saveDeliveryRule(fake, shop, id, "create", pickupRule, null),
    /could not confirm/,
  );
  assert.equal(await getDeliveryRule(first.id, id), null);
  assert.equal(
    native[0].enabled,
    false,
    "A lost create response cannot leave a new rule active",
  );
  const row = await saveDeliveryRule(
    fake,
    shop,
    id,
    "create",
    pickupRule,
    null,
  );
  assert.equal(
    native.length,
    1,
    "Retry updates the existing Shopify rule after a lost response",
  );
  assert.equal(native[0].enabled, true);
  assert.equal(
    native[0].metafield?.jsonValue?.productTags?.[0],
    "warehouse-only",
  );
  assert.equal(await getDeliveryRule(second.id, id), null);
  await assert.rejects(() =>
    saveDeliveryRule(fake, otherShop, id, "edit", pickupRule, row.revision),
  );
  assert.equal(
    (await getDeliveryStatus(fake, [row], await getOrCreateShop(shop))).states[
      id
    ],
    "active",
  );

  failed = true;
  await assert.rejects(
    () =>
      saveDeliveryRule(
        fake,
        shop,
        id,
        "edit",
        { ...pickupRule, name: "New name" },
        row.revision,
      ),
    /Temporary publication error/,
  );
  failed = false;
  assert.equal((await getDeliveryRule(first.id, id))?.name, pickupRule.name);
  assert.equal(native[0].metafield?.jsonValue?.rule.name, pickupRule.name);
  const switchMode = (mode: "DELIVERY_CUSTOMIZATION" | "CCS_RATES") =>
    changeDeliveryRuntime(fake, shop, { mode }, (tx) =>
      switchOperatingMode(shop, mode, tx),
    );
  partialActivate = true;
  await assert.rejects(
    () => switchMode(OperatingMode.CCS_RATES),
    /activation error/,
  );
  assert.equal(
    native[0].enabled,
    true,
    "Compensate a partial pause after Shopify returned an error",
  );
  assert.equal(
    (await getOrCreateShop(shop)).mode,
    OperatingMode.DELIVERY_CUSTOMIZATION,
  );
  await switchMode(OperatingMode.CCS_RATES);
  assert.equal(native[0].enabled, false);
  capacity = 25;
  await assert.rejects(
    () => switchMode(OperatingMode.DELIVERY_CUSTOMIZATION),
    /25 active/,
  );
  assert.equal((await getOrCreateShop(shop)).mode, OperatingMode.CCS_RATES);
  capacity = 0;
  await switchMode(OperatingMode.DELIVERY_CUSTOMIZATION);
  assert.equal(native[0].enabled, true);

  const setAppEnabled = (appEnabled: boolean) =>
    changeDeliveryRuntime(fake, shop, { appEnabled }, (tx) =>
      updateDeliverySettings(shop, { appEnabled, weightUnit: "kg" }, tx),
    );
  await setAppEnabled(false);
  assert.equal(native[0].enabled, false);
  await setAppEnabled(true);
  assert.equal(native[0].enabled, true);
  const advancedRule: DeliveryRule = {
    ...pickupRule,
    scope: "advanced",
    conditions: [{ field: "vendor", operator: "equals", value: "Warehouse" }],
  };
  capacity = 24;
  const advanced = await saveDeliveryRule(
    fake,
    shop,
    id,
    "edit",
    advancedRule,
    row.revision,
  );
  assert.equal(native.length, 2);
  assert.equal(native[0].enabled, false);
  assert.equal(
    native[1].enabled,
    true,
    "Only Advanced runs after changing scope at capacity",
  );
  assert.equal(
    (await getDeliveryStatus(fake, [advanced], await getOrCreateShop(shop)))
      .states[id],
    "active",
  );
  const switchedBack = await saveDeliveryRule(
    fake,
    shop,
    id,
    "edit",
    pickupRule,
    advanced.revision,
  );
  assert.equal(
    native.length,
    2,
    "Switching back reuses the earlier Basic configuration",
  );
  assert.equal(native[0].enabled, true);
  assert.equal(native[1].enabled, false);
  await saveDeliveryRule(
    fake,
    shop,
    id,
    "edit",
    { ...pickupRule, active: false },
    switchedBack.revision,
  );
  assert.equal(native[0].enabled, false);
  assert.equal((await getDeliveryRule(first.id, id))?.active, false);
  console.log(
    "M3 per-shop publication, retries, capacity, activation and mode switching passed.",
  );
} finally {
  await prisma.store.deleteMany({
    where: { shopDomain: { in: [shop, otherShop] } },
  });
  await prisma.$disconnect();
}
