import { createHash } from "node:crypto";
import type { DeliveryRule as StoredRule, Prisma, Store } from "@prisma/client";
import prisma from "../db.server";
import { DELIVERY_LIMIT, type DeliveryRule } from "./delivery-customization";
import {
  deliveryAdmin,
  DeliverySyncError,
  type AdminQuery,
  type NativeDeliveryRule,
} from "./delivery-customization-admin.server";

type CheckoutState =
  "active" | "inactive" | "paused" | "out-of-sync" | "unavailable";

export async function getDeliveryRule(storeId: string, id: string) {
  return prisma.deliveryRule.findFirst({ where: { storeId, id } });
}

export async function getDeliveryRules(storeId: string) {
  return prisma.deliveryRule.findMany({
    where: { storeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getDeliveryStatus(
  graphql: AdminQuery,
  rows: StoredRule[],
  store: Store,
) {
  try {
    const remote = await deliveryAdmin(graphql).list();
    const owned = ownedRows(remote);
    const states = Object.fromEntries(
      rows.map((row) => {
        const variants = owned.filter((item) => ruleId(item) === row.id);
        return [row.id, checkoutState(row, variants, runsDeliveryRules(store))];
      }),
    );
    return {
      states,
      used: remote.filter((item) => item.enabled).length,
      issue: null,
    };
  } catch (error) {
    const states = Object.fromEntries(
      rows.map((row) => [row.id, "unavailable" as const]),
    );
    return { states, used: null, issue: syncErrorMessage(error) };
  }
}

export async function saveDeliveryRule(
  graphql: AdminQuery,
  shopDomain: string,
  id: string,
  intent: "create" | "edit",
  rule: DeliveryRule,
  expectedRevision: string | null,
) {
  return lockShop(shopDomain, async (tx, store) => {
    if (
      store.mode !== "DELIVERY_CUSTOMIZATION" ||
      store.onboardingStep !== "COMPLETE"
    ) {
      throw new Response("Delivery Customization is not the selected mode.", {
        status: 409,
      });
    }
    const existing = await tx.deliveryRule.findUnique({ where: { id } });
    if (
      (existing && existing.storeId !== store.id) ||
      (!existing && intent === "edit")
    ) {
      throw new Response("Customization not found.", { status: 404 });
    }
    const revision = createHash("sha256")
      .update(JSON.stringify(rule))
      .digest("hex");
    if (
      existing &&
      existing.revision !== expectedRevision &&
      existing.revision !== revision
    ) {
      throw new DeliverySyncError(
        "This customization was updated elsewhere. Copy your changes, then reopen the customization.",
      );
    }

    const admin = deliveryAdmin(graphql);
    let remote: NativeDeliveryRule[];
    try {
      remote = await admin.list();
    } catch (error) {
      // A never-published inactive draft can be saved without the Function.
      if (rule.active || existing?.active || intent === "edit") throw error;
      remote = [];
    }
    const enabled = rule.active && runsDeliveryRules(store);
    await publishDeliverySnapshot(admin, remote, rule, id, revision, enabled);
    const values = { name: rule.name, active: rule.active, rule, revision };
    return existing
      ? tx.deliveryRule.update({
          where: { id, storeId: store.id },
          data: values,
        })
      : tx.deliveryRule.create({ data: { id, storeId: store.id, ...values } });
  });
}

export async function publishDeliverySnapshot(
  admin: ReturnType<typeof deliveryAdmin>,
  remote: NativeDeliveryRule[],
  rule: DeliveryRule,
  id: string,
  revision: string,
  enabled: boolean,
) {
  const variants = ownedRows(remote).filter((item) => ruleId(item) === id);
  const current = forScope(variants, rule, revision);
  const otherEnabled = remote.filter(
    (item) => item.enabled && !variants.includes(item),
  ).length;
  if (enabled) enforceCapacity(otherEnabled, 1);
  if (variants.length === 0 && !rule.active) return;

  // Shopify accepts functionHandle on update but does not change an existing binding.
  // Keep one record per scope and never enable both versions of the same rule.
  const previous = variants.filter(
    (item) => item.enabled && item.id !== current?.id,
  );
  if (current && previous.length === 0) {
    await admin.publish(rule, id, revision, enabled, current);
    return;
  }
  // A lost create response can only leave an inactive record. A retry finds it by
  // the stable ShipFlow rule ID in the app-owned metafield.
  const published = await admin.publish(rule, id, revision, false, current);
  try {
    await admin.activate(
      previous.map((item) => item.id),
      false,
    );
    if (enabled) await admin.activate([published.id], true);
  } catch (error) {
    try {
      if (!current?.enabled) await admin.activate([published.id], false);
      await admin.activate(
        [
          ...previous.map((item) => item.id),
          ...(current?.enabled ? [current.id] : []),
        ],
        true,
      );
    } catch {
      throw new DeliverySyncError(
        "Shopify could not confirm which version is active. Refresh checkout status before trying again.",
      );
    }
    throw error;
  }
}

export async function changeDeliveryRuntime<T>(
  graphql: AdminQuery,
  shopDomain: string,
  change: { mode?: NonNullable<Store["mode"]>; appEnabled?: boolean },
  save: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  let restore: (() => Promise<void>) | undefined;
  try {
    return await lockShop(shopDomain, async (tx, store) => {
      const next = { ...store, ...change };
      if (runsDeliveryRules(next) === runsDeliveryRules(store)) return save(tx);

      const rows = await tx.deliveryRule.findMany({
        where: { storeId: store.id },
      });
      const admin = deliveryAdmin(graphql);
      let remote: NativeDeliveryRule[];
      try {
        remote = await admin.list();
      } catch (error) {
        if (rows.length > 0) throw error;
        return save(tx);
      }
      const owned = ownedRows(remote);
      const active = rows.filter((row) => row.active);
      const shouldRun = runsDeliveryRules(next);
      const enable = new Set<string>();
      if (shouldRun) {
        const otherEnabled = remote.filter(
          (item) => item.enabled && !owned.includes(item),
        ).length;
        enforceCapacity(otherEnabled, active.length);
      }
      const originallyEnabled = owned
        .filter((item) => item.enabled)
        .map((item) => item.id);
      const disabledDuringChange: string[] = [];
      const enabledDuringChange: string[] = [];
      restore = async () => {
        await admin.activate(enabledDuringChange, false);
        await admin.activate(disabledDuringChange, true);
      };

      if (shouldRun) {
        for (const row of active) {
          const rule = row.rule as DeliveryRule;
          const variants = owned.filter((item) => ruleId(item) === row.id);
          const item = forScope(variants, rule, row.revision);
          if (!item || item.metafield?.jsonValue?.revision !== row.revision) {
            const confirmed = await admin.publish(
              rule,
              row.id,
              row.revision,
              item?.enabled ?? false,
              item,
            );
            enable.add(confirmed.id);
          } else {
            enable.add(item.id);
          }
        }
      }
      try {
        disabledDuringChange.push(
          ...originallyEnabled.filter((id) => !enable.has(id)),
        );
        await admin.activate(disabledDuringChange, false);
        enabledDuringChange.push(
          ...[...enable].filter((id) => !originallyEnabled.includes(id)),
        );
        await admin.activate(enabledDuringChange, true);
        return await save(tx);
      } catch (error) {
        const compensate = restore;
        restore = undefined;
        await restoreCheckout(compensate);
        throw error;
      }
    });
  } catch (error) {
    if (restore) {
      // The callback completed but PostgreSQL could not commit.
      await lockShop(shopDomain, async () => restoreCheckout(restore!));
    }
    throw error;
  }
}

async function restoreCheckout(restore: () => Promise<void>) {
  try {
    await restore();
  } catch {
    throw new DeliverySyncError(
      "Shopify could not confirm checkout status. Review the delivery customizations in Shopify before trying again.",
    );
  }
}

export function syncErrorMessage(error: unknown) {
  return error instanceof DeliverySyncError
    ? error.message
    : "The change could not be saved. Try again.";
}

function runsDeliveryRules(store: Pick<Store, "mode" | "appEnabled">) {
  return store.mode === "DELIVERY_CUSTOMIZATION" && store.appEnabled;
}

function ownedRows(rows: NativeDeliveryRule[]) {
  return rows.filter(
    (row) =>
      row.metafield?.jsonValue?.version === 1 &&
      typeof row.metafield.jsonValue.ruleId === "string",
  );
}

function forScope(
  variants: NativeDeliveryRule[],
  rule: DeliveryRule,
  revision: string,
) {
  const matching = variants.filter(
    (item) => item.metafield?.jsonValue?.rule?.scope === rule.scope,
  );
  return (
    matching.find((item) => item.enabled) ??
    matching.find((item) => item.metafield?.jsonValue?.revision === revision) ??
    matching[0]
  );
}

function ruleId(row: NativeDeliveryRule) {
  return row.metafield!.jsonValue!.ruleId;
}

function checkoutState(
  row: StoredRule,
  variants: NativeDeliveryRule[],
  running: boolean,
): CheckoutState {
  const enabled = variants.filter((native) => native.enabled);
  if (
    enabled.length > 1 ||
    enabled.some(
      (native) =>
        !row.active ||
        !running ||
        native.metafield?.jsonValue?.revision !== row.revision,
    )
  ) {
    return "out-of-sync";
  }
  if (!row.active) return "inactive";
  if (!running) return "paused";
  return enabled.length === 1 ? "active" : "out-of-sync";
}

function enforceCapacity(used: number, adding: number) {
  if (used + adding > DELIVERY_LIMIT) {
    throw new DeliverySyncError(
      "This store can have up to 25 active delivery customizations across all apps. Deactivate one in Shopify before activating more.",
    );
  }
}

async function lockShop<T>(
  shopDomain: string,
  callback: (tx: Prisma.TransactionClient, store: Store) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${shopDomain}))`;
      const store = await tx.store.findUniqueOrThrow({ where: { shopDomain } });
      return callback(tx, store);
    },
    { maxWait: 5_000, timeout: 45_000 },
  );
}
