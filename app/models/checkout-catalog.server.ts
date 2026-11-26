import type { AdminQuery } from "./delivery-customization-admin.server";
import {
  parseMoney,
  positiveShopifyId,
  type CarrierCart,
} from "./calculated-rates";
import { RateFormError } from "./calculated-rates.server";

const VARIANTS = `#graphql
  query ShipFlowSimulatorVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id title price sku
        product { title vendor isGiftCard }
        inventoryItem { requiresShipping measurement { weight { value unit } } }
      }
    }
  }`;
const LOCATIONS = `#graphql
  query ShipFlowSimulatorLocations($after: String) {
    locations(first: 100, after: $after) {
      nodes { id name address { countryCode provinceCode zip city address1 address2 } }
      pageInfo { endCursor hasNextPage }
    }
  }`;
const CUSTOMER_SEARCH = `#graphql
  query ShipFlowSearchCustomers($query: String!, $after: String) {
    customers(first: 25, query: $query, after: $after) {
      nodes { id firstName lastName }
      pageInfo { endCursor hasNextPage }
    }
  }`;
const CUSTOMER_NAMES = `#graphql
  query ShipFlowHistoryCustomerNames($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Customer { id firstName lastName }
    }
  }`;
const CUSTOMER = `#graphql
  query ShipFlowSimulatorCustomer($id: ID!) {
    customer(id: $id) { id firstName tags }
  }`;

async function query<T>(
  graphql: AdminQuery,
  document: string,
  variables: Record<string, unknown>,
) {
  const response = await graphql(document, { variables, tries: 1 });
  const result = (await response.json()) as { data?: T; errors?: unknown[] };
  if (!response.ok || !result.data || result.errors?.length)
    throw new Error("Shopify checkout inputs unavailable");
  return result.data;
}

type Variant = {
  id: string;
  title: string;
  price: string;
  sku: string | null;
  product: { title: string; vendor: string; isGiftCard: boolean };
  inventoryItem: {
    requiresShipping: boolean;
    measurement: {
      weight: { value: number; unit: keyof typeof gramsPerUnit } | null;
    };
  };
};
const gramsPerUnit = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  OUNCES: 28.349523125,
  POUNDS: 453.59237,
};
const variantPattern = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
export const customerPattern = /^gid:\/\/shopify\/Customer\/[1-9]\d{0,19}$/;

export function simulatorQuantities(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    throw new RateFormError("Add between 1 and 50 product variants.");
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (
      typeof item?.id !== "string" ||
      !variantPattern.test(item.id) ||
      !/^[1-9]\d{0,3}$/.test(String(item.quantity)) ||
      quantities.has(item.id)
    )
      throw new RateFormError(
        "Enter a whole quantity from 1 to 9,999 for each variant.",
      );
    quantities.set(item.id, Number(item.quantity));
  }
  return quantities;
}

export async function getSimulatorLines(
  graphql: AdminQuery,
  quantities: Map<string, number>,
  currency: string,
) {
  const data = await query<{ nodes: (Variant | null)[] }>(graphql, VARIANTS, {
    ids: [...quantities.keys()],
  }).catch(() => {
    throw new RateFormError(
      "Shopify could not load the selected variants. Check product access and try again.",
    );
  });
  const variants = data.nodes.filter((node): node is Variant =>
    Boolean(node?.id && quantities.has(node.id)),
  );
  if (variants.length !== quantities.size)
    throw new RateFormError(
      "A selected variant is no longer available. Remove it and try again.",
    );
  const lines: CarrierCart["lines"] = [];
  let subtotal = 0;
  for (const variant of variants) {
    const quantity = quantities.get(variant.id)!;
    const [whole, fraction = ""] = variant.price.split(".");
    const decimals = fraction.replace(/0+$/, "");
    const price = parseMoney(
      decimals ? `${whole}.${decimals}` : whole,
      currency,
    );
    if (!variant.product.isGiftCard) subtotal += price * quantity;
    if (!variant.inventoryItem.requiresShipping) continue;
    const weight = variant.inventoryItem.measurement.weight;
    const name =
      variant.title === "Default Title"
        ? variant.product.title
        : `${variant.product.title} - ${variant.title}`;
    lines.push({
      variantId: variant.id.split("/").at(-1),
      name,
      quantity,
      price,
      grams: weight
        ? Math.round(weight.value * gramsPerUnit[weight.unit])
        : null,
      sku: variant.sku?.trim() ?? "",
      vendor: variant.product.vendor.trim(),
    });
  }
  if (!lines.length)
    throw new RateFormError("Add a variant that requires shipping.");
  return { lines, subtotal };
}

type Location = {
  id: string;
  name: string;
  address: {
    countryCode: string | null;
    provinceCode: string | null;
    zip: string | null;
    city: string | null;
    address1: string | null;
    address2: string | null;
  };
};
type Connection<T> = {
  nodes: T[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
};

export async function getSimulatorLocations(graphql: AdminQuery) {
  let after: string | null = null;
  const locations: Location[] = [];
  do {
    const result: { locations: Connection<Location> } = await query(
      graphql,
      LOCATIONS,
      { after },
    );
    locations.push(...result.locations.nodes);
    after = result.locations.pageInfo.hasNextPage
      ? result.locations.pageInfo.endCursor
      : null;
  } while (after);
  return locations.flatMap(({ id, name, address }) =>
    address.countryCode
      ? [
          {
            id,
            name,
            country: address.countryCode,
            province: address.provinceCode,
            postalCode: address.zip ?? undefined,
            city: address.city ?? undefined,
            street:
              [address.address1, address.address2].filter(Boolean).join(" ") ||
              undefined,
          },
        ]
      : [],
  );
}

type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};
function displayCustomer(customer: Customer) {
  return {
    id: customer.id,
    name:
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
      "Unnamed customer",
  };
}

function customerSearch(term: string) {
  // Escape Shopify search syntax so a name is always a literal term.
  return term
    .split(/\s+/)
    .map((word) => `"${word.replace(/[\\":()]/g, "\\$&")}"`)
    .join(" ");
}

export async function findCustomers(
  graphql: AdminQuery,
  term: string,
  history = false,
) {
  const customers: ReturnType<typeof displayCustomer>[] = [];
  let after: string | null = null;
  const search = customerSearch(term);
  do {
    const result: { customers: Connection<Customer> } = await query(
      graphql,
      CUSTOMER_SEARCH,
      { query: search, after },
    );
    customers.push(...result.customers.nodes.map(displayCustomer));
    after =
      history && result.customers.pageInfo.hasNextPage
        ? result.customers.pageInfo.endCursor
        : null;
  } while (after && customers.length < 250);
  return customers;
}

export async function getCustomerNames(
  graphql: AdminQuery,
  ids: (string | null)[],
) {
  const customers = [...new Set(ids)].flatMap((id) =>
    positiveShopifyId(id) ? [`gid://shopify/Customer/${id}`] : [],
  );
  if (!customers.length) return {} as Record<string, string>;
  const result = await query<{ nodes: (Customer | null)[] }>(
    graphql,
    CUSTOMER_NAMES,
    { ids: customers },
  );
  return Object.fromEntries(
    result.nodes.flatMap((customer) =>
      customer?.id
        ? [[customer.id.split("/").at(-1)!, displayCustomer(customer).name]]
        : [],
    ),
  );
}

export async function getSimulatorCustomer(graphql: AdminQuery, id: string) {
  if (!customerPattern.test(id))
    throw new RateFormError("Select a Shopify customer.");
  const result = await query<{
    customer: { id: string; firstName: string | null; tags: string[] } | null;
  }>(graphql, CUSTOMER, { id }).catch(() => null);
  if (!result?.customer)
    throw new RateFormError(
      "Shopify could not load that customer. Check customer access or simulate as a guest.",
    );
  return result.customer;
}
