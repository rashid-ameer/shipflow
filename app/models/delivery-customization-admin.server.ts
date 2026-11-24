import {
  configurationKey,
  configurationNamespace,
  functionHandles,
  type DeliveryRule,
} from "./delivery-customization";
import type { DeliveryConfiguration } from "./delivery-customization-runtime";

export type AdminQuery = (
  query: string,
  options?: { variables?: Record<string, unknown>; tries?: number },
) => Promise<Response>;

const LIST = `#graphql
  query ShipFlowDeliveryCustomizations($after: String) {
    deliveryCustomizations(first: 50, after: $after) {
      nodes {
        id
        enabled
        metafield(namespace: "$app:shipflow", key: "delivery-rule") { jsonValue }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const CREATE = `#graphql
  mutation ShipFlowCreateDeliveryCustomization($customization: DeliveryCustomizationInput!) {
    deliveryCustomizationCreate(deliveryCustomization: $customization) {
      deliveryCustomization {
        id
        enabled
        metafield(namespace: "$app:shipflow", key: "delivery-rule") { jsonValue }
      }
      userErrors { code message }
    }
  }`;

const UPDATE = `#graphql
  mutation ShipFlowUpdateDeliveryCustomization($id: ID!, $customization: DeliveryCustomizationInput!) {
    deliveryCustomizationUpdate(id: $id, deliveryCustomization: $customization) {
      deliveryCustomization {
        id
        enabled
        metafield(namespace: "$app:shipflow", key: "delivery-rule") { jsonValue }
      }
      userErrors { code message }
    }
  }`;

const ACTIVATE = `#graphql
  mutation ShipFlowActivateDeliveryCustomizations($ids: [ID!]!, $enabled: Boolean!) {
    deliveryCustomizationActivation(ids: $ids, enabled: $enabled) {
      ids
      userErrors { code message }
    }
  }`;

export class DeliverySyncError extends Error {}

export type NativeDeliveryRule = {
  id: string;
  enabled: boolean;
  metafield: { jsonValue?: DeliveryConfiguration } | null;
};

type UserError = { code?: string; message: string };
type MutationResult = {
  userErrors: UserError[];
  deliveryCustomization?: NativeDeliveryRule | null;
  ids?: string[];
};

export function deliveryAdmin(graphql: AdminQuery) {
  async function execute<T>(
    query: string,
    variables?: Record<string, unknown>,
  ) {
    try {
      // Creates have no API idempotency key. The next save reconciles by rule ID.
      const response = await graphql(query, { variables, tries: 1 });
      const payload = (await response.json()) as {
        data?: T;
        errors?: UserError[];
      };
      if (!response.ok || payload.errors?.length || !payload.data) {
        if (
          payload.errors?.some(({ message }) =>
            /access denied|scope/i.test(message),
          )
        ) {
          throw new DeliverySyncError(
            "Approve delivery customization access for ShipFlow in Shopify and try again.",
          );
        }
        throw new Error("Missing Shopify response");
      }
      return payload.data;
    } catch (error) {
      if (error instanceof DeliverySyncError) throw error;
      if (
        error instanceof Error &&
        /access denied|required.*scope/i.test(error.message)
      ) {
        throw new DeliverySyncError(
          "Approve delivery customization access for ShipFlow in Shopify and try again.",
        );
      }
      throw new DeliverySyncError(
        "Shopify could not confirm the checkout configuration. Refresh its status or try saving again.",
      );
    }
  }

  async function list() {
    type Page = {
      deliveryCustomizations: {
        nodes: NativeDeliveryRule[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
    const rows: NativeDeliveryRule[] = [];
    let after: string | null = null;
    do {
      const response: Page = await execute<Page>(LIST, { after });
      rows.push(...response.deliveryCustomizations.nodes);
      const page = response.deliveryCustomizations.pageInfo;
      after = page.hasNextPage ? page.endCursor : null;
    } while (after);
    return rows;
  }

  async function publish(
    rule: DeliveryRule,
    ruleId: string,
    revision: string,
    enabled: boolean,
    current?: NativeDeliveryRule,
  ) {
    const configuration = buildConfiguration(rule, ruleId, revision);
    const value = JSON.stringify(configuration);
    if (Buffer.byteLength(value) > 10_000)
      throw new DeliverySyncError(
        "This customization is too large for checkout. Shorten its conditions or actions and save again.",
      );
    if (current && current.metafield?.jsonValue?.rule?.scope !== rule.scope) {
      throw new DeliverySyncError(
        "Shopify requires a separate checkout configuration for this data scope.",
      );
    }
    const customization = {
      title: rule.name,
      enabled,
      ...(!current ? { functionHandle: functionHandles[rule.scope] } : {}),
      metafields: [
        {
          namespace: configurationNamespace,
          key: configurationKey,
          type: "json",
          value,
        },
      ],
    };
    const result = current
      ? (
          await execute<{ deliveryCustomizationUpdate: MutationResult }>(
            UPDATE,
            { id: current.id, customization },
          )
        ).deliveryCustomizationUpdate
      : (
          await execute<{ deliveryCustomizationCreate: MutationResult }>(
            CREATE,
            { customization },
          )
        ).deliveryCustomizationCreate;
    checkErrors(result.userErrors);
    if (
      !result.deliveryCustomization ||
      result.deliveryCustomization.enabled !== enabled ||
      result.deliveryCustomization.metafield?.jsonValue?.revision !== revision
    ) {
      throw new DeliverySyncError(
        "Shopify did not confirm the requested checkout configuration.",
      );
    }
    return result.deliveryCustomization;
  }

  async function activate(ids: string[], enabled: boolean) {
    if (ids.length === 0) return;
    const { deliveryCustomizationActivation: result } = await execute<{
      deliveryCustomizationActivation: MutationResult;
    }>(ACTIVATE, { ids, enabled });
    checkErrors(result.userErrors);
    if (!ids.every((id) => result.ids?.includes(id))) {
      throw new DeliverySyncError(
        "Shopify did not confirm all requested checkout changes.",
      );
    }
  }

  return { list, publish, activate };
}

function checkErrors(errors: UserError[]) {
  const error = errors[0];
  if (!error) return;
  if (
    /FUNCTION.*NOT_FOUND|function.*not found/i.test(
      `${error.code} ${error.message}`,
    )
  ) {
    throw new DeliverySyncError(
      "The ShipFlow checkout Function is unavailable on this store. Open a preview with the current app version or contact support.",
    );
  }
  throw new DeliverySyncError(error.message);
}

function buildConfiguration(
  rule: DeliveryRule,
  ruleId: string,
  revision: string,
): DeliveryConfiguration {
  const values = (field: DeliveryRule["conditions"][number]["field"]) =>
    Array.from(
      new Set(
        rule.conditions
          .filter((item) => item.field === field)
          .map((item) => item.value),
      ),
    );
  const first = (field: DeliveryRule["conditions"][number]["field"]) =>
    rule.conditions.find((item) => item.field === field);
  if (rule.scope === "basic") {
    return {
      version: 1,
      ruleId,
      revision,
      rule,
      productTags: values("productTag"),
      customerTags: values("customerTag"),
    };
  }
  const time = first("time");
  return {
    version: 1,
    ruleId,
    revision,
    rule,
    collections: values("collection"),
    cartKey: first("cartAttribute")?.key ?? "_shipflow_unused",
    lineKey: first("lineAttribute")?.key ?? "_shipflow_unused",
    start: time ? `${time.value}:00` : "00:00:00",
    end: time ? `${time.upper}:59` : "23:59:59",
  };
}
