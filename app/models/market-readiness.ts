export type CarrierServiceSnapshot = {
  active: boolean;
  callbackUrl: string | null;
};

export type ShippingConfigurationSnapshot = {
  isEnabled: boolean;
  optionDefinitions: {
    nodes: Array<{
      __typename: string;
      isActive?: boolean;
      rateGroups?: {
        nodes: Array<{
          carrierService: CarrierServiceSnapshot;
        }>;
      } | null;
    }>;
  };
};

export type MarketSnapshot = {
  id: string;
  name: string;
  status: "ACTIVE" | "DRAFT";
  parentMarkets: { nodes: Array<{ id: string }> };
  delivery: { shipping: ShippingConfigurationSnapshot | null };
};

export type MarketReadiness = {
  id: string;
  name: string;
  ready: boolean;
  manageUrl: string;
};

export type MarketsDashboardData =
  | {
      status: "available";
      marketDrivenShipping: boolean;
      readyCount: number;
      totalCount: number;
      markets: MarketReadiness[];
      manageUrl: string;
    }
  | {
      status: "unavailable";
      reason: "permission" | "request";
      manageUrl: string;
    };

function appOrigin(appUrl: string): string | null {
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

function isShipFlowService(
  service: CarrierServiceSnapshot,
  expectedOrigin: string | null,
) {
  if (!service.active || !service.callbackUrl || !expectedOrigin) return false;

  try {
    return new URL(service.callbackUrl).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function effectiveShipping(
  market: MarketSnapshot,
  marketsById: Map<string, MarketSnapshot>,
  visited = new Set<string>(),
): ShippingConfigurationSnapshot | null {
  if (market.delivery.shipping) return market.delivery.shipping;
  if (visited.has(market.id)) return null;

  const nextVisited = new Set(visited).add(market.id);
  for (const parent of market.parentMarkets.nodes) {
    const parentMarket = marketsById.get(parent.id);
    if (!parentMarket) continue;
    const inherited = effectiveShipping(parentMarket, marketsById, nextVisited);
    if (inherited) return inherited;
  }

  return null;
}

function shippingUsesShipFlow(
  shipping: ShippingConfigurationSnapshot | null,
  expectedOrigin: string | null,
) {
  if (!shipping?.isEnabled) return false;

  return shipping.optionDefinitions.nodes.some((option) => {
    if (
      option.__typename !== "DeliveryCarrierCalculatedOptionDefinition" ||
      option.isActive !== true
    ) {
      return false;
    }

    return Boolean(
      option.rateGroups?.nodes.some(({ carrierService }) =>
        isShipFlowService(carrierService, expectedOrigin),
      ),
    );
  });
}

export function marketsAdminUrl(shopDomain: string) {
  return `https://${shopDomain}/admin/settings/markets`;
}

export function buildMarketReadiness(
  marketSnapshots: MarketSnapshot[],
  shopDomain: string,
  appUrl: string,
): MarketReadiness[] {
  const marketsById = new Map(
    marketSnapshots.map((market) => [market.id, market]),
  );
  const expectedOrigin = appOrigin(appUrl);
  const manageUrl = marketsAdminUrl(shopDomain);

  return marketSnapshots
    .filter((market) => market.status === "ACTIVE")
    .map((market) => ({
      id: market.id,
      name: market.name,
      ready: shippingUsesShipFlow(
        effectiveShipping(market, marketsById),
        expectedOrigin,
      ),
      manageUrl,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
