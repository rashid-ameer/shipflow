import type { AdminQuery } from "./delivery-customization-admin.server";
import type { DimensionMapping, DimensionAxis } from "./product-dimensions";

type Page<T> = {
  nodes: T[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
};
export type Field = {
  namespace: string;
  key: string;
  type: string;
  jsonValue: unknown;
};
type Variant = {
  id: string;
  title: string;
  sku: string | null;
  barcodes: { nodes: { value: string }[] };
  metafields?: { nodes: Field[] };
};
type Product = {
  id: string;
  title: string;
  tags: string[];
  productType: string;
  vendor: string;
  variants: Page<Variant>;
  metafields?: { nodes: Field[] };
};
const PRODUCT_PAGE = `#graphql
  query ShipFlowCatalogPage($query: String!, $first: Int!) {
    products(first: $first, sortKey: ID, query: $query) {
      pageInfo { hasNextPage }
      nodes { id title tags productType vendor
        variants(first: 10) {
          nodes { id title sku barcodes(first: 1) { nodes { value } } }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }`;
const PRODUCT = `#graphql
  query ShipFlowCatalogProduct($id: ID!, $cursor: String) {
    product(id: $id) { id title tags productType vendor
      variants(first: 100, after: $cursor) {
        nodes { id title sku barcodes(first: 1) { nodes { value } } }
        pageInfo { endCursor hasNextPage }
      }
    }
  }`;
const METAFIELDS = `#graphql
  query ShipFlowDimensionFields($ids: [ID!]!, $variantKeys: [String!]!, $productKeys: [String!]!, $readVariants: Boolean!, $readProducts: Boolean!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        metafields(first: 3, keys: $variantKeys) @include(if: $readVariants) {
          nodes { namespace key type jsonValue }
        }
        product {
          metafields(first: 3, keys: $productKeys) @include(if: $readProducts) {
            nodes { namespace key type jsonValue }
          }
        }
      }
    }
  }`;

export function catalogId(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const raw = String(value ?? "");
  return /^[1-9]\d{0,18}$/.test(raw) &&
    BigInt(raw) <= 9_223_372_036_854_775_807n
    ? BigInt(raw)
    : null;
}

export function resourceId(gid: string) {
  const id = catalogId(gid.split("/").at(-1));
  if (!id) throw new Error("Shopify returned an invalid catalog ID.");
  return id;
}

async function queryData<T>(
  graphql: AdminQuery,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await graphql(query, {
    variables,
    tries: 2,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as { data?: T; errors?: unknown[] };
  if (!response.ok || payload.errors?.length || !payload.data)
    throw new Error("Shopify catalog data is temporarily unavailable.");
  return payload.data;
}

async function allVariants(graphql: AdminQuery, product: Product) {
  let { endCursor, hasNextPage } = product.variants.pageInfo;
  const variants = [...product.variants.nodes];
  while (hasNextPage) {
    if (!endCursor)
      throw new Error("Shopify did not return the next variants page.");
    const next = await queryData<{ product: Product | null }>(
      graphql,
      PRODUCT,
      { id: product.id, cursor: endCursor },
    );
    if (!next.product) return null;
    variants.push(...next.product.variants.nodes);
    ({ endCursor, hasNextPage } = next.product.variants.pageInfo);
  }
  return { ...product, allVariants: variants };
}

export async function shopifyCatalogPage(
  graphql: AdminQuery,
  cursor: bigint,
  first: number,
) {
  const { products } = await queryData<{ products: Page<Product> }>(
    graphql,
    PRODUCT_PAGE,
    {
      query: `id:>${cursor}`,
      first,
    },
  );
  const firstLarge = products.nodes.findIndex(
    (product) => product.variants.pageInfo.hasNextPage,
  );
  const scanned =
    firstLarge < 0 ? products.nodes : products.nodes.slice(0, firstLarge + 1);
  const items = [];
  for (const product of scanned) {
    const complete = await allVariants(graphql, product);
    if (complete) items.push(complete);
  }
  return {
    items,
    scanned: scanned.length,
    more:
      scanned.length < products.nodes.length || products.pageInfo.hasNextPage,
    cursor: scanned.length ? resourceId(scanned.at(-1)!.id) : cursor,
  };
}

export async function shopifyCatalogProduct(graphql: AdminQuery, id: bigint) {
  const { product } = await queryData<{ product: Product | null }>(
    graphql,
    PRODUCT,
    {
      id: `gid://shopify/Product/${id}`,
      cursor: null,
    },
  );
  return product ? allVariants(graphql, product) : null;
}

export async function shopifyDimensionFields(
  graphql: AdminQuery,
  ids: bigint[],
  mapping: DimensionMapping,
) {
  const keys = (owner: DimensionMapping[DimensionAxis]["owner"]) => [
    ...new Set(
      Object.values(mapping)
        .filter((field) => field.owner === owner && field.key)
        .map(({ namespace, key }) => `${namespace}.${key}`),
    ),
  ];
  const variantKeys = keys("variant");
  const productKeys = keys("product");
  const { nodes } = await queryData<{
    nodes: (Variant & { product: Pick<Product, "metafields"> })[];
  }>(graphql, METAFIELDS, {
    ids: ids.map((id) => `gid://shopify/ProductVariant/${id}`),
    variantKeys,
    productKeys,
    readVariants: variantKeys.length > 0,
    readProducts: productKeys.length > 0,
  });
  return new Map(
    nodes.filter(Boolean).map((node) => [resourceId(node.id), node]),
  );
}
