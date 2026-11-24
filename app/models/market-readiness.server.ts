import {
  buildMarketReadiness,
  marketsAdminUrl,
  type MarketSnapshot,
  type MarketsDashboardData,
} from "./market-readiness";
import { resolveShopifyAppUrl } from "../app-url.server";

export const MARKET_READINESS_LIMITS = {
  markets: 50,
  optionDefinitions: 25,
  rateGroups: 10,
} as const;

export const MARKET_READINESS_QUERY = `#graphql
  query ShipFlowMarketReadiness {
    shop {
      features {
        marketDrivenShipping
      }
    }
    markets(first: ${MARKET_READINESS_LIMITS.markets}, type: REGION) {
      nodes {
        id
        name
        status
        parentMarkets(first: 10) {
          nodes {
            id
          }
        }
        delivery {
          shipping {
            isEnabled
            optionDefinitions(first: ${MARKET_READINESS_LIMITS.optionDefinitions}, active: true) {
              nodes {
                __typename
                ... on DeliveryCarrierCalculatedOptionDefinition {
                  isActive
                  rateGroups(first: ${MARKET_READINESS_LIMITS.rateGroups}) {
                    nodes {
                      carrierService {
                        id
                        active
                        callbackUrl
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type AdminGraphql = (query: string) => Promise<Response>;

type MarketReadinessResponse = {
  data?: {
    shop: { features: { marketDrivenShipping: boolean } };
    markets: { nodes: MarketSnapshot[] };
  };
  errors?: Array<{ message: string }>;
};

export async function getMarketsDashboardData(
  graphql: AdminGraphql,
  shopDomain: string,
  appUrl = resolveShopifyAppUrl(process.env),
  carrierId?: string | null,
): Promise<MarketsDashboardData> {
  const manageUrl = marketsAdminUrl(shopDomain);

  try {
    const response = await graphql(MARKET_READINESS_QUERY);
    const result = (await response.json()) as MarketReadinessResponse;

    if (!response.ok || result.errors?.length || !result.data) {
      const permissionError = result.errors?.some(({ message }) =>
        /access|scope|permission/i.test(message),
      );
      return {
        status: "unavailable",
        reason: permissionError ? "permission" : "request",
        manageUrl,
      };
    }

    const markets = buildMarketReadiness(
      result.data.markets.nodes,
      shopDomain,
      appUrl,
      carrierId,
    );

    return {
      status: "available",
      marketDrivenShipping: result.data.shop.features.marketDrivenShipping,
      readyCount: markets.filter(({ ready }) => ready).length,
      totalCount: markets.length,
      markets,
      manageUrl,
    };
  } catch {
    return { status: "unavailable", reason: "request", manageUrl };
  }
}
