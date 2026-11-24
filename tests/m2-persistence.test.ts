import assert from "node:assert/strict";

import prisma from "../app/db.server";
import {
  completeOnboarding,
  getOrCreateShop,
  OperatingMode,
  setTestMode,
  switchOperatingMode,
  updateBasicSettings,
  updateDeliverySettings,
} from "../app/models/shop-settings.server";

const suffix = `${process.pid}-${Date.now()}`;
const firstShop = `m2-first-${suffix}.myshopify.com`;
const secondShop = `m2-second-${suffix}.myshopify.com`;
const storeIds: string[] = [];

try {
  for (const shop of [firstShop, secondShop]) {
    const store = await getOrCreateShop(shop);
    storeIds.push(store.id);
    await completeOnboarding(shop, OperatingMode.CCS_RATES);
  }

  await updateBasicSettings(firstShop, {
    appEnabled: false,
    weightUnit: "lb",
    distanceUnit: "mi",
    dimensionUnit: "in",
    volumetricDivisor: 139,
    multipleRates: "priority",
    rounding: "nearest-half",
  });

  const reopenedFirst = await getOrCreateShop(firstShop);
  assert.equal(reopenedFirst.appEnabled, false);
  assert.equal(reopenedFirst.settings.weightUnit, "lb");
  assert.equal(reopenedFirst.settings.distanceUnit, "mi");
  assert.equal(reopenedFirst.settings.dimensionUnit, "in");
  assert.equal(reopenedFirst.settings.volumetricDivisor, 139);
  assert.equal(reopenedFirst.settings.multipleRates, "priority");
  assert.equal(reopenedFirst.settings.rounding, "nearest-half");

  const untouchedSecond = await getOrCreateShop(secondShop);
  assert.equal(untouchedSecond.appEnabled, true);
  assert.equal(untouchedSecond.settings.weightUnit, "kg");
  assert.equal(untouchedSecond.settings.multipleRates, "all");
  assert.equal(untouchedSecond.settings.rounding, "none");
  assert.equal(untouchedSecond.testMode, true);

  assert.equal((await getOrCreateShop(firstShop)).testMode, true);
  await setTestMode(firstShop, false);
  assert.equal((await getOrCreateShop(firstShop)).testMode, false);
  assert.equal((await getOrCreateShop(secondShop)).testMode, true);

  await switchOperatingMode(secondShop, OperatingMode.DELIVERY_CUSTOMIZATION);
  await assert.rejects(
    () => setTestMode(secondShop, false),
    (error: unknown) => error instanceof Response && error.status === 409,
  );
  await updateDeliverySettings(secondShop, {
    appEnabled: true,
    weightUnit: "oz",
  });
  const deliverySettings = (await getOrCreateShop(secondShop)).settings;
  assert.equal(deliverySettings.weightUnit, "oz");
  assert.equal(deliverySettings.volumetricDivisor, 5000);

  console.log("M2 per-shop settings and Test Mode persistence passed.");
} finally {
  await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.$disconnect();
}
