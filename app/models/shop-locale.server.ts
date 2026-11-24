type AdminGraphql = (query: string) => Promise<Response>;

const SHOP_LOCALE_QUERY = `#graphql
  query ShopLocale {
    shop {
      currencyCode
      ianaTimezone
    }
  }
`;

export type ShopLocale = {
  currencyCode: string;
  ianaTimezone: string;
  available: boolean;
};

export async function getShopLocale(
  graphql: AdminGraphql,
): Promise<ShopLocale> {
  try {
    const response = await graphql(SHOP_LOCALE_QUERY);
    const payload = (await response.json()) as {
      data?: { shop?: { currencyCode?: string; ianaTimezone?: string } };
    };
    const shop = payload.data?.shop;
    if (!shop?.currencyCode || !shop.ianaTimezone)
      throw new Error("Missing shop locale");
    return {
      currencyCode: shop.currencyCode,
      ianaTimezone: shop.ianaTimezone,
      available: true,
    };
  } catch {
    return {
      currencyCode: "Unavailable",
      ianaTimezone: "Unavailable",
      available: false,
    };
  }
}

export { SHOP_LOCALE_QUERY };
