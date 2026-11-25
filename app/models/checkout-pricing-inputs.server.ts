import {
  matchRegion,
  productConditionFields,
  type CarrierCart,
  type Region,
  type Scenario,
} from "./calculated-rates";
import { moneyDecimals } from "./checkout-values";
import type { AdminQuery } from "./delivery-customization-admin.server";

const VARIANT_DATA = `#graphql
  query ShipFlowPricingVariantData($ids: [ID!]!, $collections: Boolean!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id sku barcode
        product {
          id title vendor tags productType
          collections(first: 30) @include(if: $collections) {
            nodes { title }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }`;
const COLLECTION_PAGE = `#graphql
  query ShipFlowPricingCollections($id: ID!, $after: String!) {
    product(id: $id) {
      collections(first: 50, after: $after) {
        nodes { title }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
const CUSTOMER_METRICS = `#graphql
  query ShipFlowPricingCustomer($id: ID!) {
    customer(id: $id) {
      firstName lastName numberOfOrders
      amountSpent { amount currencyCode }
    }
  }`;

type Collections = {
  nodes: { title: string }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
type Variant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  product: {
    id: string;
    title: string;
    vendor: string;
    tags: string[];
    productType: string;
    collections?: Collections;
  };
};
type Customer = {
  firstName: string | null;
  lastName: string | null;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
};

async function adminData<T>(
  graphql: AdminQuery,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await graphql(query, { variables, tries: 1 });
  const payload = (await response.json()) as { data?: T };
  return response.ok ? payload.data : undefined;
}

export async function addPricingInputs(
  cart: CarrierCart,
  regions: Region[],
  scenarios: Scenario[],
  getGraphql: () => Promise<AdminQuery>,
): Promise<CarrierCart> {
  const region = matchRegion(regions, cart.destination);
  if (!region) return cart;
  const fields = new Set<string>();
  let customerData = false;
  for (const scenario of scenarios) {
    const rates = scenario.rates.filter(
      (rate) =>
        rate.active !== false &&
        rate.regionId === region.id &&
        rate.currency === cart.currency,
    );
    if (!scenario.active || !rates.length) continue;
    for (const condition of scenario.conditions) {
      const field = productConditionFields[condition.field];
      if (field) fields.add(field);
      if (condition.scope?.startsWith("tag")) fields.add("tags");
      if (condition.scope?.startsWith("sku")) fields.add("sku");
      if (
        condition.field === "previousOrders" ||
        condition.field === "previousSpent" ||
        (condition.field === "customerName" && !cart.customer?.name)
      )
        customerData = true;
    }
    for (const rate of rates)
      if (rate.pricing?.filter) fields.add(rate.pricing.filter.field);
  }
  const requested = [...fields];
  const ids = [
    ...new Set(
      cart.lines.flatMap((line) =>
        line.variantId &&
        requested.some(
          (field) => line[field as keyof typeof line] === undefined,
        )
          ? [`gid://shopify/ProductVariant/${line.variantId}`]
          : [],
      ),
    ),
  ];
  const customerId = customerData ? cart.customerId : undefined;
  if (!ids.length && !customerId) return cart;

  let stop = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expire = new Promise<CarrierCart>((resolve) => {
    timeout = setTimeout(() => {
      stop = true;
      resolve(cart);
    }, 1_200);
  });
  async function load() {
    const graphql = await getGraphql();
    if (stop) return cart;
    const [variants, customer] = await Promise.all([
      loadVariants(graphql, ids, fields.has("collections"), () => stop),
      customerId
        ? adminData<{ customer: Customer | null }>(graphql, CUSTOMER_METRICS, {
            id: `gid://shopify/Customer/${customerId}`,
          }).catch(() => undefined)
        : undefined,
    ]);
    const details = customer?.customer;
    const spent = details?.amountSpent;
    const count = details ? Number(details.numberOfOrders) : NaN;
    const amount =
      spent && /^[A-Z]{3}$/.test(spent.currencyCode)
        ? Math.round(
            Number(spent.amount) * 10 ** moneyDecimals(spent.currencyCode),
          )
        : NaN;
    return {
      ...cart,
      lines: cart.lines.map((line) => {
        const variant = line.variantId
          ? variants.get(`gid://shopify/ProductVariant/${line.variantId}`)
          : undefined;
        return variant
          ? {
              ...line,
              barcode: line.barcode ?? variant.barcode ?? "",
              sku: line.sku ?? variant.sku ?? "",
              name: line.name ?? variant.product.title,
              vendor: line.vendor ?? variant.product.vendor,
              tags: variant.product.tags,
              productType: variant.product.productType,
              collections: variant.product.collections?.pageInfo.hasNextPage
                ? undefined
                : variant.product.collections?.nodes.map(({ title }) => title),
            }
          : line;
      }),
      customer: {
        ...cart.customer,
        name:
          cart.customer?.name ??
          ([details?.firstName, details?.lastName].filter(Boolean).join(" ") ||
            undefined),
        previousOrders:
          Number.isSafeInteger(count) && count >= 0
            ? count
            : cart.customer?.previousOrders,
        previousSpent:
          Number.isSafeInteger(amount) && amount >= 0
            ? amount
            : cart.customer?.previousSpent,
        spentCurrency: spent?.currencyCode ?? cart.customer?.spentCurrency,
      },
    };
  }
  try {
    return await Promise.race([load().catch(() => cart), expire]);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadVariants(
  graphql: AdminQuery,
  ids: string[],
  collections: boolean,
  stopped: () => boolean,
) {
  const result = new Map<string, Variant>();
  const batch = collections ? 20 : 100;
  const byProduct = new Map<string, Promise<Collections | undefined>>();
  for (let index = 0; !stopped() && index < ids.length; index += batch) {
    const data = await adminData<{ nodes: (Variant | null)[] }>(
      graphql,
      VARIANT_DATA,
      { ids: ids.slice(index, index + batch), collections },
    ).catch(() => undefined);
    for (const variant of data?.nodes ?? []) {
      if (!variant?.id || !variant.product) continue;
      if (variant.product.collections?.pageInfo.hasNextPage) {
        if (!byProduct.has(variant.product.id))
          byProduct.set(
            variant.product.id,
            fetchCollections(
              graphql,
              variant.product.id,
              variant.product.collections,
              stopped,
            ),
          );
        variant.product.collections = await byProduct.get(variant.product.id);
      }
      result.set(variant.id, variant);
    }
  }
  return result;
}

async function fetchCollections(
  graphql: AdminQuery,
  id: string,
  first: Collections,
  stopped: () => boolean,
) {
  const nodes = [...first.nodes];
  let pageInfo = first.pageInfo;
  while (pageInfo.hasNextPage && pageInfo.endCursor && !stopped()) {
    const response = await adminData<{
      product?: { collections: Collections };
    }>(graphql, COLLECTION_PAGE, { id, after: pageInfo.endCursor }).catch(
      () => undefined,
    );
    if (!response?.product) return undefined;
    nodes.push(...response.product.collections.nodes);
    pageInfo = response.product.collections.pageInfo;
  }
  return pageInfo.hasNextPage ? undefined : { nodes, pageInfo };
}
