import type { Prisma, Store } from "@prisma/client";
import prisma from "../db.server";
import { data } from "react-router";
import { getStorePricingContext } from "./carrier-shopify.server";
import type { AdminQuery } from "./delivery-customization-admin.server";
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
        ({ id, regionId, name, description, amount, currency }) => ({
          id,
          regionId,
          name,
          description,
          price: formatRateAmount(amount, currency),
          currency,
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
      select: { weightUnit: true },
    });
    const input = validate(() =>
      validateScenario(
        draft,
        currency,
        settings?.weightUnit ?? "kg",
        regions.map((row) => row.id),
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
          entry.individual === condition.individual,
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
  const pageCount = Math.max(1, Math.ceil(count / 25));
  const current = Math.min(page, pageCount);
  const rows = await prisma.rateScenario.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (current - 1) * 25,
    take: 25,
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
): Promise<{ regions: Region[]; scenarios: Scenario[] }> {
  const [regions, scenarios] = await Promise.all([
    prisma.shippingRegion.findMany({ where: { storeId } }),
    prisma.rateScenario.findMany({
      where: { storeId, active: true },
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
      active: row.active,
      conditions: row.conditions.map((item) => item.condition as RateCondition),
      rates: row.rates,
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

export function requireCarrier(store: Store) {
  if (!store.carrierServiceId || store.ccsStatus !== "ENABLED") {
    throw new RateFormError(
      "Connect the Carrier Service before activating scenarios.",
    );
  }
}

async function lockRatesStore<T>(
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
