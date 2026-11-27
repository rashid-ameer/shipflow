import type { Prisma, Store } from "@prisma/client";
import prisma from "../db.server";
import { data } from "react-router";
import { getStorePricingContext } from "./carrier-shopify.server";
import type { AdminQuery } from "./delivery-customization-admin.server";
import type { RatePricing } from "./rate-pricing";
import type { LiveCarrierRate } from "./live-carrier";
import {
  coverageConflict,
  formatRateAmount,
  type Coverage,
  type RateCondition,
  type Region,
  type Scenario,
  validName,
  validateCoverage,
  validateScenario,
} from "./calculated-rates";
import {
  clampIndexPage,
  INDEX_PAGE_SIZE,
  indexPageCount,
} from "../pagination";

export class RateFormError extends Error {}

export async function loadRatesContext(graphql: AdminQuery, store: Store) {
  const context = await getStorePricingContext(graphql).catch(() => null);
  if (
    context?.country &&
    (await prisma.shippingRegion.count({ where: { storeId: store.id } })) === 0
  ) {
    await lockRatesStore(store.shopDomain, async (tx) => {
      if ((await tx.shippingRegion.count({ where: { storeId: store.id } })) > 0)
        return;
      await tx.shippingRegion.createMany({
        data: [
          {
            storeId: store.id,
            kind: "DOMESTIC",
            name: "Domestic",
            coverage: [{ country: context.country, provinces: [] }],
          },
          {
            storeId: store.id,
            kind: "REST",
            name: "Rest of the World",
            coverage: [],
          },
        ],
      });
    });
  }
  return context;
}

export async function listRegions(storeId: string) {
  const rows = await prisma.shippingRegion.findMany({
    where: { storeId },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { rates: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    coverage: row.coverage as Coverage[],
    rateCount: row._count.rates,
  }));
}

export async function saveRegion(
  shop: string,
  id: string | null,
  nameValue: unknown,
  entries: unknown,
) {
  const name = validate(() => validName(nameValue, "region"));
  const coverage = validate(() => validateCoverage(entries));
  if (name.toLowerCase() === "rest of the world")
    throw new RateFormError("Rest of the World is managed automatically.");
  return lockRatesStore(shop, async (tx, store) => {
    const rows = await tx.shippingRegion.findMany({
      where: { storeId: store.id },
    });
    const current = rows.find((row) => row.id === id);
    if (id && (!current || current.kind === "REST"))
      throw new RateFormError("This region cannot be edited.");
    const other = rows.filter((row) => row.id !== id);
    if (other.some((row) => row.name.toLowerCase() === name.toLowerCase()))
      throw new RateFormError("A region already uses that name.");
    const conflict = coverageConflict(coverage, other as unknown as Region[]);
    if (conflict)
      throw new RateFormError(
        `This coverage overlaps with ${conflict.name}. Choose different countries or provinces.`,
      );
    if (!current) {
      if (rows.length === 0) {
        await tx.shippingRegion.create({
          data: {
            storeId: store.id,
            name: "Rest of the World",
            kind: "REST",
            coverage: [],
          },
        });
      }
      return tx.shippingRegion.create({
        data: { storeId: store.id, kind: "CUSTOM", name, coverage },
      });
    }
    return tx.shippingRegion.update({
      where: { id: current.id },
      data: { name, coverage },
    });
  });
}

export async function deleteRegion(
  shop: string,
  id: string,
  confirmedAttachedCount: number,
) {
  return lockRatesStore(shop, async (tx, store) => {
    const region = await tx.shippingRegion.findFirst({
      where: { id, storeId: store.id },
      include: { _count: { select: { rates: true } } },
    });
    if (!region || region.kind === "REST")
      throw new RateFormError("This region cannot be deleted.");
    const named = await tx.shippingRegion.count({
      where: { storeId: store.id, kind: { not: "REST" } },
    });
    if (named <= 1)
      throw new RateFormError("Keep at least one named shipping region.");
    if (region._count.rates !== confirmedAttachedCount)
      throw new RateFormError(
        "The attached rates changed. Refresh and confirm the new count.",
      );
    await tx.shippingRegion.delete({ where: { id } });
  });
}

export async function getScenario(storeId: string, id: string) {
  const row = await prisma.rateScenario.findFirst({
    where: { id, storeId },
    include: {
      conditions: { orderBy: { position: "asc" } },
      rates: { orderBy: { position: "asc" } },
    },
  });
  if (!row) return null;
  return {
    revision: row.updatedAt.toISOString(),
    draft: {
      name: row.name,
      active: row.active,
      conditions: row.conditions.map((item) => item.condition as RateCondition),
      rates: row.rates.map(
        ({
          id,
          regionId,
          name,
          description,
          amount,
          currency,
          pricing,
          liveCarrier,
          serviceCode,
          minDays,
          maxDays,
          active,
          tags,
          notes,
        }) => ({
          id,
          regionId,
          name,
          description,
          price:
            pricing && (pricing as RatePricing).mode !== "flat"
              ? ""
              : formatRateAmount(amount, currency),
          currency,
          pricing: pricing ? (pricing as RatePricing) : undefined,
          liveCarrier: liveCarrier
            ? (liveCarrier as LiveCarrierRate)
            : undefined,
          serviceCode,
          minDays,
          maxDays,
          active,
          tags: tags.join(", "),
          notes,
        }),
      ),
    },
  };
}

export async function saveScenario(
  shop: string,
  id: string | null,
  revision: string | null,
  draft: unknown,
  currency: string,
) {
  return lockRatesStore(shop, async (tx, store) => {
    const regions = await tx.shippingRegion.findMany({
      where: { storeId: store.id },
      select: { id: true },
    });
    const settings = await tx.storeSettings.findUnique({
      where: { storeId: store.id },
      select: { weightUnit: true, dimensionUnit: true, distanceUnit: true },
    });
    const input = validate(() =>
      validateScenario(
        draft,
        currency,
        settings?.weightUnit ?? "kg",
        regions.map((row) => row.id),
        settings?.dimensionUnit,
        settings?.distanceUnit,
      ),
    );
    const existing = id
      ? await tx.rateScenario.findFirst({
          where: { id, storeId: store.id },
          include: {
            conditions: { orderBy: { position: "asc" } },
            rates: true,
          },
        })
      : null;
    if (id && !existing)
      throw new RateFormError("This scenario no longer exists.");
    if (existing && existing.updatedAt.toISOString() !== revision)
      throw new RateFormError(
        "This scenario changed elsewhere. Reopen it before saving.",
      );
    if (input.active) requireCarrier(store);
    await assertRateCodesAvailable(
      tx,
      store.id,
      input.rates.map((rate) => rate.serviceCode),
      { scenarioId: id },
    );

    // Keep the unit of an unchanged saved threshold when Settings defaults change.
    const savedConditions =
      existing?.conditions.map((entry) => entry.condition as RateCondition) ??
      [];
    const conditions = input.conditions.map((condition) => {
      const unchanged = savedConditions.find(
        (entry) =>
          entry.field === condition.field &&
          entry.operator === condition.operator &&
          entry.value === condition.value &&
          entry.upper === condition.upper &&
          entry.scope === condition.scope &&
          entry.scopeValue === condition.scopeValue &&
          entry.provinceCountry === condition.provinceCountry &&
          entry.individual === condition.individual &&
          entry.distanceUnit === condition.distanceUnit,
      );
      return unchanged ?? condition;
    });
    if (
      existing?.rates.some(
        (rate) =>
          input.rates.some((entry) => entry.id === rate.id) &&
          rate.currency !== currency,
      )
    ) {
      throw new RateFormError(
        "The store currency changed. Recreate rates in the new store currency before saving.",
      );
    }
    const row = existing
      ? await tx.rateScenario.update({
          where: { id: existing.id },
          data: { name: input.name, active: input.active },
        })
      : await tx.rateScenario.create({
          data: { storeId: store.id, name: input.name, active: input.active },
        });
    if (existing) {
      await tx.rateCondition.deleteMany({ where: { scenarioId: row.id } });
      await tx.fixedShippingRate.deleteMany({
        where: { storeId: store.id, scenarioId: row.id },
      });
    }
    await tx.rateCondition.createMany({
      data: conditions.map((condition, position) => ({
        scenarioId: row.id,
        condition,
        position,
      })),
    });
    await tx.fixedShippingRate.createMany({
      data: input.rates.map((rate, position) => ({
        ...rate,
        pricing: rate.pricing as Prisma.InputJsonValue | undefined,
        liveCarrier: rate.liveCarrier as Prisma.InputJsonValue | undefined,
        scenarioId: row.id,
        storeId: store.id,
        position,
      })),
    });
    return row;
  });
}

export async function listScenarios(
  storeId: string,
  search: string,
  status: string,
  page: number,
) {
  const where = {
    storeId,
    ...(search
      ? { name: { contains: search, mode: "insensitive" as const } }
      : {}),
    ...(status === "active" || status === "inactive"
      ? { active: status === "active" }
      : {}),
  };
  const [total, count] = await Promise.all([
    prisma.rateScenario.count({ where: { storeId } }),
    prisma.rateScenario.count({ where }),
  ]);
  const pageCount = indexPageCount(count);
  const current = clampIndexPage(page, count);
  const rows = await prisma.rateScenario.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (current - 1) * INDEX_PAGE_SIZE,
    take: INDEX_PAGE_SIZE,
    select: {
      id: true,
      name: true,
      active: true,
      updatedAt: true,
      _count: { select: { rates: true } },
    },
  });
  return { rows, total, count, page: current, pageCount };
}

export async function changeScenarios(
  shop: string,
  ids: string[],
  intent: "activate" | "deactivate" | "delete",
) {
  return lockRatesStore(shop, async (tx, store) => {
    const where = { storeId: store.id, id: { in: ids } };
    if ((await tx.rateScenario.count({ where })) !== ids.length)
      throw new RateFormError("A selected scenario is no longer available.");
    if (intent === "delete") await tx.rateScenario.deleteMany({ where });
    else {
      if (intent === "activate") requireCarrier(store);
      await tx.rateScenario.updateMany({
        where,
        data: { active: intent === "activate" },
      });
    }
  });
}

export async function loadActivePricing(
  storeId: string,
  scenarioIds?: string[],
): Promise<{ regions: Region[]; scenarios: Scenario[] }> {
  const [regions, scenarios] = await Promise.all([
    prisma.shippingRegion.findMany({ where: { storeId } }),
    prisma.rateScenario.findMany({
      where: scenarioIds
        ? { storeId, id: { in: scenarioIds } }
        : { storeId, active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        conditions: { orderBy: { position: "asc" } },
        rates: { orderBy: { position: "asc" } },
      },
    }),
  ]);
  return {
    regions: regions.map((region) => ({
      ...region,
      coverage: region.coverage as Coverage[],
    })),
    scenarios: scenarios.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      conditions: row.conditions.map((item) => item.condition as RateCondition),
      rates: row.rates.map(({ pricing, liveCarrier, ...rate }) => ({
        ...rate,
        pricing: pricing ? (pricing as RatePricing) : undefined,
        liveCarrier: liveCarrier ? (liveCarrier as LiveCarrierRate) : undefined,
      })),
    })),
  };
}

export function rateFormFailure(error: unknown) {
  return data(
    {
      ok: false as const,
      error:
        error instanceof RateFormError
          ? error.message
          : "The change could not be saved. Try again.",
    },
    { status: 422 },
  );
}

export function requireCarrier(store: Store, resource = "scenarios") {
  if (!store.carrierServiceId || store.ccsStatus !== "ENABLED") {
    throw new RateFormError(
      `Connect the Carrier Service before activating ${resource}.`,
    );
  }
}

export async function lockRatesStore<T>(
  shop: string,
  update: (tx: Prisma.TransactionClient, store: Store) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${shop}))`;
    const store = await tx.store.findUniqueOrThrow({
      where: { shopDomain: shop },
    });
    if (store.mode !== "CCS_RATES" || store.onboardingStep !== "COMPLETE")
      throw new RateFormError(
        "Select CCS Rates before editing shipping rates.",
      );
    return update(tx, store);
  });
}

export async function assertRateCodesAvailable(
  tx: Prisma.TransactionClient,
  storeId: string,
  codes: (string | null | undefined)[],
  excluded: { scenarioId?: string | null; combinedId?: string | null },
) {
  const nonempty = codes.filter((code): code is string => Boolean(code));
  if (!nonempty.length) return;
  const unique = new Set(nonempty.map((code) => code.toLowerCase()));
  if (unique.size !== nonempty.length)
    throw new RateFormError("Use a unique code for each shipping rate.");
  const serviceCode = { in: [...unique], mode: "insensitive" as const };
  const [scenarioRate, combinedRate] = await Promise.all([
    tx.fixedShippingRate.findFirst({
      where: {
        storeId,
        serviceCode,
        ...(excluded.scenarioId
          ? { scenarioId: { not: excluded.scenarioId } }
          : {}),
      },
      select: { serviceCode: true },
    }),
    tx.combinedRateRule.findFirst({
      where: {
        storeId,
        serviceCode,
        ...(excluded.combinedId ? { id: { not: excluded.combinedId } } : {}),
      },
      select: { serviceCode: true },
    }),
  ]);
  if (scenarioRate || combinedRate)
    throw new RateFormError("This shipping rate code is already in use.");
}

function validate<T>(run: () => T) {
  try {
    return run();
  } catch (error) {
    throw new RateFormError(
      error instanceof Error
        ? error.message
        : "Check the values and try again.",
    );
  }
}
