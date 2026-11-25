import type { CombinedRateRule, Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  lockRatesStore,
  RateFormError,
  requireCarrier,
} from "./calculated-rates.server";
import { combinedDraft, validateCombinedDraft } from "./combined-rates";

export const combinedPageSize = 25;

export function combinedEditorData(row: CombinedRateRule) {
  const { storeId: _store, position: _position, updatedAt, ...rule } = row;
  return { draft: combinedDraft(rule), revision: updatedAt.toISOString() };
}

export async function listCombinedRules(
  storeId: string,
  filters: {
    search: string;
    status: "all" | "active" | "inactive";
    page: number;
    sort: "priority" | "name";
  },
) {
  const where: Prisma.CombinedRateRuleWhereInput = {
    storeId,
    ...(filters.search
      ? { name: { contains: filters.search, mode: "insensitive" } }
      : {}),
    ...(filters.status !== "all"
      ? { active: filters.status === "active" }
      : {}),
  };
  const [total, count] = await Promise.all([
    prisma.combinedRateRule.count({ where: { storeId } }),
    prisma.combinedRateRule.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(count / combinedPageSize));
  const page = Math.min(filters.page, pageCount);
  const rows = await prisma.combinedRateRule.findMany({
    where,
    orderBy:
      filters.sort === "name"
        ? [{ name: "asc" }, { position: "asc" }]
        : { position: "asc" },
    skip: (page - 1) * combinedPageSize,
    take: combinedPageSize,
    select: {
      id: true,
      name: true,
      active: true,
      position: true,
      tags: true,
      method: true,
      requirement: true,
      requireTwoTags: true,
      outputTag: true,
    },
  });
  return { rows, total, page, pageCount };
}

export async function getCombinedRule(storeId: string, id: string) {
  const row = await prisma.combinedRateRule.findFirst({
    where: { storeId, id },
  });
  return row ? combinedEditorData(row) : null;
}

export async function saveCombinedRule(
  shop: string,
  id: string | null,
  revision: string,
  raw: unknown,
) {
  let rule: ReturnType<typeof validateCombinedDraft>;
  try {
    rule = validateCombinedDraft(raw);
  } catch (error) {
    throw new RateFormError(
      error instanceof Error
        ? error.message
        : "Check the combination settings.",
    );
  }
  return lockRatesStore(shop, async (tx, store) => {
    if (rule.active) requireCarrier(store, "combined rates");
    if (id) {
      const saved = await tx.combinedRateRule.findFirst({
        where: { id, storeId: store.id },
      });
      if (!saved)
        throw new RateFormError("This combined rate no longer exists.");
      if (saved.updatedAt.toISOString() !== revision)
        throw new RateFormError(
          "This combined rate changed elsewhere. Reopen it before editing.",
        );
      return tx.combinedRateRule.update({ where: { id }, data: rule });
    }
    const last = await tx.combinedRateRule.aggregate({
      where: { storeId: store.id },
      _max: { position: true },
    });
    return tx.combinedRateRule.create({
      data: {
        ...rule,
        storeId: store.id,
        position: (last._max.position ?? 0) + 1,
      },
    });
  });
}

export async function changeCombinedRules(
  shop: string,
  ids: string[],
  intent: "activate" | "deactivate" | "delete",
) {
  return lockRatesStore(shop, async (tx, store) => {
    const where = { storeId: store.id, id: { in: ids } };
    if ((await tx.combinedRateRule.count({ where })) !== ids.length)
      throw new RateFormError(
        "A selected combined rate is no longer available.",
      );
    if (intent === "delete") return tx.combinedRateRule.deleteMany({ where });
    if (intent === "activate") requireCarrier(store, "combined rates");
    return tx.combinedRateRule.updateMany({
      where,
      data: { active: intent === "activate" },
    });
  });
}

export async function moveCombinedRule(
  shop: string,
  id: string,
  position: number,
  direction: "up" | "down",
) {
  return lockRatesStore(shop, async (tx, store) => {
    const current = await tx.combinedRateRule.findFirst({
      where: { storeId: store.id, id },
    });
    if (!current || current.position !== position)
      throw new RateFormError(
        "The rule order changed. Refresh before moving it.",
      );
    const up = direction === "up";
    const neighbor = await tx.combinedRateRule.findFirst({
      where: {
        storeId: store.id,
        position: up ? { lt: position } : { gt: position },
      },
      orderBy: { position: up ? "desc" : "asc" },
    });
    if (!neighbor) return;
    await tx.combinedRateRule.update({ where: { id }, data: { position: -1 } });
    await tx.combinedRateRule.update({
      where: { id: neighbor.id },
      data: { position },
    });
    await tx.combinedRateRule.update({
      where: { id },
      data: { position: neighbor.position },
    });
  });
}

export async function loadCombinedRules(storeId: string, selected?: string[]) {
  const rows = await prisma.combinedRateRule.findMany({
    where: {
      storeId,
      ...(selected ? { id: { in: selected } } : { active: true }),
    },
    orderBy: { position: "asc" },
  });
  if (selected && selected.length !== rows.length)
    throw new RateFormError(
      "A selected combined rate is no longer available. Refresh and try again.",
    );
  return selected ? rows.map((row) => ({ ...row, active: true })) : rows;
}
