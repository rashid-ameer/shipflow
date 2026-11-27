import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../app/db.server";
import {
  queueCatalogProduct,
  requestCatalogSync,
  runCatalogBatch,
  runCatalogChange,
} from "../app/models/catalog.server";
import {
  importDimensionsCsv,
  exportDimensionsCsv,
  parseDimensionsCsv,
  sendDimensionEmail,
} from "../app/models/dimensions-csv.server";
import {
  readDimensionMapping,
  totalVolume,
} from "../app/models/product-dimensions";
import {
  emptyPackage,
  emptyPacking,
  packByDimensions,
  validatePacking,
} from "../app/models/package-pricing";
import {
  normalizeCarrierPayload,
  type CarrierCart,
  type ScenarioDraft,
} from "../app/models/calculated-rates";
import {
  getScenario,
  saveScenario,
} from "../app/models/calculated-rates.server";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../app/models/checkout-pricing.server";
import {
  completeOnboarding,
  OperatingMode,
} from "../app/models/shop-settings.server";
import { signCarrierCallback } from "../app/models/carrier-shopify.server";
import { action } from "../app/routes/carrier-rates";

const payload = {
  rate: {
    origin: { country: "US" },
    destination: { country: "US", name: "shipflow" },
    currency: "USD",
    items: [
      {
        product_id: "101",
        variant_id: "201",
        name: "Bulky lamp",
        quantity: 2,
        grams: 500,
        price: 1500,
      },
    ],
  },
};
const rawCart = normalizeCarrierPayload(payload)!;
assert.equal(rawCart.lines[0].variantId, "201");

const packing = validatePacking(
  {
    ...emptyPacking,
    method: "dimensions",
    rotate: true,
    packages: [
      {
        ...emptyPackage,
        name: "Low box",
        rate: "5",
        maxWeight: "3",
        emptyWeight: "0.25",
        length: "40",
        width: "30",
        height: "20",
      },
    ],
  },
  "USD",
  "fixed",
  "kg",
  "cm",
);
const from = (
  length: number,
  width: number,
  height: number,
): CarrierCart["lines"] =>
  rawCart.lines.map((line) => ({
    ...line,
    dimensions: { length, width, height },
  }));
assert.equal(totalVolume(from(30, 20, 50)), 60_000);
assert.equal(totalVolume(from(30, 20, 50), true), 30_000);
assert.ok(
  "reason" in packByDimensions({ ...packing, rotate: false }, from(30, 40, 20)),
);
assert.deepEqual(packByDimensions(packing, from(30, 40, 20)), [
  { package: packing.packages[0], count: 2 },
]);
assert.equal("reason" in packByDimensions(packing, rawCart.lines), true);
assert.throws(
  () => parseDimensionsCsv("length,width,height\n1,2,3", "cm"),
  /columns/,
);
assert.throws(
  () =>
    parseDimensionsCsv(
      'product_id,variant_id,length,width,height\n"101,201,40,30,20',
      "cm",
    ),
  /unclosed/,
);
assert.equal(
  parseDimensionsCsv(
    "product_id,variant_id,length,width,height\n101,201.1,40,30,20",
    "cm",
  ).invalid,
  1,
);
assert.equal(
  parseDimensionsCsv(
    "product_id,variant_id,length,width,height\n101,201,40,30,20\n101,201,40,30,20",
    "cm",
  ).entries.length,
  0,
);

const providerFetch = globalThis.fetch;
const originalMailKey = process.env.RESEND_API_KEY;
const originalSender = process.env.SHIPFLOW_EMAIL_FROM;
try {
  process.env.RESEND_API_KEY = "fixture";
  process.env.SHIPFLOW_EMAIL_FROM = "shipflow@example.test";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    const message = JSON.parse(String(init?.body));
    assert.deepEqual(message.to, ["owner@example.test"]);
    if (message.subject === "Dimensions")
      assert.equal(
        Buffer.from(message.attachments[0].content, "base64").toString(),
        "length,width,height",
      );
    else assert.equal(message.text, "Updated 1 variant.");
    return Response.json({ id: "accepted" });
  };
  await sendDimensionEmail(
    "owner@example.test",
    "Dimensions",
    "Fill in the file.",
    { filename: "dimensions.csv", csv: "length,width,height" },
  );
  await sendDimensionEmail(
    "owner@example.test",
    "Import results",
    "Updated 1 variant.",
  );
} finally {
  globalThis.fetch = providerFetch;
  if (originalMailKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalMailKey;
  if (originalSender === undefined) delete process.env.SHIPFLOW_EMAIL_FROM;
  else process.env.SHIPFLOW_EMAIL_FROM = originalSender;
}

const shop = `m8-${randomUUID()}.myshopify.com`;
const second = `m8-${randomUUID()}.myshopify.com`;
const originalSecret = process.env.SHOPIFY_API_SECRET;
const secret = randomUUID();
process.env.SHOPIFY_API_SECRET = secret;
const product = {
  id: "gid://shopify/Product/101",
  title: "Bulky lamp",
  tags: ["Decor"],
  vendor: "Studio",
  productType: "Lighting",
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/201",
        title: "White",
        sku: "LAMP",
        barcodes: { nodes: [{ value: "213" }] },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};
let latest = { ...product };
const graphql = async (input: string) =>
  Response.json({
    data: input.includes("ShipFlowCatalogPage")
      ? { products: { nodes: [latest], pageInfo: { hasNextPage: false } } }
      : input.includes("ShipFlowCatalogProduct")
        ? { product: latest }
        : {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/201",
                metafields: {
                  nodes: [
                    {
                      namespace: "custom",
                      key: "length",
                      type: "dimension",
                      jsonValue: { value: 0.4, unit: "m" },
                    },
                  ],
                },
                product: {
                  metafields: {
                    nodes: [
                      {
                        namespace: "custom",
                        key: "width",
                        type: "number_decimal",
                        jsonValue: "30",
                      },
                    ],
                  },
                },
              },
            ],
          },
  });

try {
  const [store, other] = await Promise.all([
    completeOnboarding(shop, OperatingMode.CCS_RATES),
    completeOnboarding(second, OperatingMode.CCS_RATES),
  ]);
  await requestCatalogSync(store.id, "cm");
  await runCatalogBatch(store.id, async () => graphql);
  assert.equal(
    await prisma.catalogProduct.count({ where: { storeId: store.id } }),
    1,
  );
  assert.ok(
    (await prisma.catalogSync.findUnique({ where: { storeId: store.id } }))
      ?.lastSyncAt,
  );
  await requestCatalogSync(store.id, "cm");
  let attempts = 0;
  await runCatalogBatch(store.id, async () => {
    attempts++;
    return async () =>
      Response.json(
        { errors: [{ message: "Temporary failure" }] },
        { status: 503 },
      );
  });
  const paused = await prisma.catalogSync.findUniqueOrThrow({
    where: { storeId: store.id },
  });
  assert.equal(paused.job, "catalog");
  assert.ok(paused.retryAt);
  assert.equal(
    await runCatalogBatch(store.id, async () => {
      attempts++;
      return graphql;
    }),
    false,
  );
  assert.equal(attempts, 1);
  await prisma.catalogSync.update({
    where: { storeId: store.id },
    data: { retryAt: new Date(0) },
  });
  await runCatalogBatch(store.id, async () => graphql);
  assert.equal(
    (
      await prisma.catalogSync.findUniqueOrThrow({
        where: { storeId: store.id },
      })
    ).error,
    null,
  );

  const importReport = await importDimensionsCsv(
    store.id,
    "product_id,variant_id,length,width,height,unit\r\n101,201,400,300,200,mm\r\n102,202,7,8,z,cm",
    "cm",
  );
  assert.deepEqual([importReport.updated, importReport.invalid], [1, 1]);
  assert.equal(
    (
      await importDimensionsCsv(
        other.id,
        "product_id,variant_id,length,width,height\n101,201,40,30,20",
        "cm",
      )
    ).updated,
    0,
  );
  await requestCatalogSync(store.id, "cm");
  await runCatalogBatch(store.id, async () => graphql);
  assert.equal(
    (
      await prisma.catalogVariant.findUnique({
        where: { storeId_id: { storeId: store.id, id: 201n } },
      })
    )?.length,
    40,
  );
  latest = { ...product, title: "Bulky floor lamp" };
  await queueCatalogProduct(store.id, 101n);
  await queueCatalogProduct(store.id, 101n);
  const change = await prisma.catalogProductChange.findFirstOrThrow({
    where: { storeId: store.id },
  });
  await runCatalogChange(change, async () => graphql);
  assert.equal(
    (await prisma.catalogProduct.findFirst({ where: { storeId: store.id } }))
      ?.title,
    latest.title,
  );
  assert.equal(
    await prisma.catalogProductChange.count({ where: { storeId: store.id } }),
    0,
  );

  await requestCatalogSync(
    store.id,
    "cm",
    readDimensionMapping({
      length: { owner: "variant", namespace: "custom", key: "length" },
      width: { owner: "product", namespace: "custom", key: "width" },
    }),
  );
  await runCatalogBatch(store.id, async () => graphql);
  const row = await prisma.catalogVariant.findFirstOrThrow({
    where: { storeId: store.id },
  });
  assert.deepEqual([row.length, row.width, row.height], [40, 30, 20]);
  for await (const exported of exportDimensionsCsv(store.id, "cm"))
    assert.match(exported, /101,201,40,30,20,cm/);
  const variantVolumetric = (row.length! * row.width! * row.height!) / 5_000;
  assert.equal(variantVolumetric, 4.8);

  await prisma.store.update({
    where: { id: store.id },
    data: {
      ccsStatus: "ENABLED",
      carrierServiceId: `gid://shopify/DeliveryCarrierService/${store.id}`,
    },
  });
  const region = await prisma.shippingRegion.create({
    data: {
      storeId: store.id,
      kind: "DOMESTIC",
      name: "Domestic",
      coverage: [{ country: "US", provinces: [] }],
    },
  });
  const make = (name: string) => ({
    id: randomUUID(),
    regionId: region.id,
    name,
    description: "",
    price: "19",
  });
  const draft: ScenarioDraft = {
    name: "Bulky items",
    active: true,
    conditions: [
      { field: "cartVolumetric", operator: "eq", value: "9.6" },
      {
        field: "productVolume",
        operator: "eq",
        value: "24000",
        individual: true,
      },
    ],
    rates: [
      {
        ...make("Dimensional shipping"),
        pricing: {
          mode: "package",
          criteria: "cart",
          basis: "total",
          amountType: "fixed",
          packing: {
            ...emptyPacking,
            split: "volumetric",
            packages: [
              { ...emptyPackage, name: "Small carton", limit: "5", rate: "4" },
              { ...emptyPackage, name: "Large carton", limit: "10", rate: "7" },
            ],
          },
        },
      },
    ],
  };
  const saved = await saveScenario(shop, null, null, draft, "USD");
  const reopened = await getScenario(store.id, saved.id);
  assert.equal(reopened?.draft.rates[0].pricing?.packing?.packages.length, 2);
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "Fallback",
      active: true,
      conditions: [{ field: "cartQuantity", operator: "gte", value: "1" }],
      rates: [make("Standard")],
    },
    "USD",
  );
  const pricing = (await getPricingStore(store.id))!;
  const preview = await evaluateStoreCart(pricing, rawCart, {
    simulation: true,
  });
  assert.deepEqual(
    preview.rates.map((rate) => rate.total_price),
    ["700", "1900"],
  );
  assert.match(
    preview.trace?.rates[0].steps?.[0].label ?? "",
    /Large carton × 1/,
  );
  const signature = signCarrierCallback(store.id, secret);
  const callback = () =>
    action({
      request: new Request("https://example.test/carrier-rates", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }),
      params: { storeId: store.id, signature },
      context: {},
      url: new URL("https://example.test/carrier-rates"),
      pattern: "/carrier-rates/:storeId/:signature",
    } as ActionFunctionArgs);
  const response = await callback();
  assert.deepEqual((await response.json()).rates, preview.rates);
  const record = await prisma.carrierRequest.findFirstOrThrow({
    where: { storeId: store.id },
  });
  assert.match(JSON.stringify(record.trace), /Large carton/);
  await prisma.catalogVariant.update({
    where: { storeId_id: { storeId: store.id, id: 201n } },
    data: { height: null },
  });
  const missing = await evaluateStoreCart(pricing, rawCart, {
    simulation: true,
  });
  assert.deepEqual(
    missing.rates.map((rate) => rate.service_name),
    ["Standard"],
  );
  assert.deepEqual((await (await callback()).json()).rates, missing.rates);
  await queueCatalogProduct(store.id, 101n);
  const deleted = await prisma.catalogProductChange.findFirstOrThrow({
    where: { storeId: store.id },
  });
  await runCatalogChange(
    deleted,
    async () => async () => Response.json({ data: { product: null } }),
  );
  assert.equal(
    await prisma.catalogVariant.count({ where: { storeId: store.id } }),
    0,
  );
  console.log(
    "M8 catalog retries, product changes, tenant isolation, CSV errors, metafields, 4.8 kg per unit, package selection, callback parity and missing dimensions passed.",
  );
} finally {
  await prisma.store.deleteMany({
    where: { shopDomain: { in: [shop, second] } },
  });
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = originalSecret;
}
