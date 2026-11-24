import assert from "node:assert/strict";

import prisma from "../app/db.server";
import {
  completeOnboarding,
  continueFromWelcome,
  getOrCreateShop,
  OnboardingStep,
  OperatingMode,
  parseUnits,
  saveUnits,
  switchOperatingMode,
  updateUnits,
} from "../app/models/shop-settings.server";

const shopDomain = `m1-verification-${process.pid}.myshopify.com`;
let testStoreId: string | null = null;

try {
  const created = await getOrCreateShop(shopDomain);
  testStoreId = created.id;
  assert.equal(created.onboardingStep, OnboardingStep.WELCOME);
  assert.equal(created.settings.weightUnit, "kg");
  assert.equal((await getOrCreateShop(shopDomain)).id, created.id);

  const unitsStep = await continueFromWelcome(shopDomain);
  assert.equal(unitsStep.onboardingStep, OnboardingStep.UNITS);

  const savedDefaults = await updateUnits(shopDomain, {
    weightUnit: "lb",
    distanceUnit: "mi",
    dimensionUnit: "in",
    volumetricDivisor: 139,
  });
  assert.equal(savedDefaults.onboardingStep, OnboardingStep.UNITS);
  assert.equal(savedDefaults.settings?.volumetricDivisor, 139);

  const invalidUnits = new FormData();
  invalidUnits.set("weightUnit", "kg");
  invalidUnits.set("distanceUnit", "km");
  invalidUnits.set("dimensionUnit", "cm");
  invalidUnits.set("volumetricDivisor", "0");
  const invalid = parseUnits(invalidUnits);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(
      invalid.fields.volumetricDivisor,
      "Enter a volumetric divisor greater than 0.",
    );
  }

  const modeStep = await saveUnits(shopDomain, {
    weightUnit: "lb",
    distanceUnit: "mi",
    dimensionUnit: "in",
    volumetricDivisor: 139,
  });
  assert.equal(modeStep.onboardingStep, OnboardingStep.MODE);
  assert.equal(modeStep.settings?.volumetricDivisor, 139);

  const onboarded = await completeOnboarding(
    shopDomain,
    OperatingMode.DELIVERY_CUSTOMIZATION,
  );
  assert.equal(onboarded.onboardingStep, OnboardingStep.COMPLETE);
  assert.equal(onboarded.mode, OperatingMode.DELIVERY_CUSTOMIZATION);

  await prisma.store.update({
    where: { shopDomain },
    data: { testMode: false },
  });
  const firstCcsSelection = await switchOperatingMode(
    shopDomain,
    OperatingMode.CCS_RATES,
  );
  assert.equal(firstCcsSelection.testMode, true);
  assert.ok(firstCcsSelection.ccsModeSelectedAt);

  await switchOperatingMode(shopDomain, OperatingMode.DELIVERY_CUSTOMIZATION);
  await prisma.store.update({
    where: { shopDomain },
    data: { testMode: false },
  });
  const laterCcsSelection = await switchOperatingMode(
    shopDomain,
    OperatingMode.CCS_RATES,
  );
  assert.equal(laterCcsSelection.testMode, false);

  console.log("M1 persistence transitions passed.");
} finally {
  if (testStoreId) {
    await prisma.store.delete({ where: { id: testStoreId } });
  }
  await prisma.$disconnect();
}
