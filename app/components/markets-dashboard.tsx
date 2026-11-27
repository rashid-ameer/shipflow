import { BorderedCard } from "./bordered-card";
import {
  IndexTableFilterChips,
  IndexTableFilters,
  IndexTableSection,
} from "./index-table";
import { useState } from "react";

import type { MarketsDashboardData } from "../models/market-readiness";

type MarketFilter = "all" | "ready" | "needs-setup";

const pressedState = (pressed: boolean) => ({
  "aria-pressed": pressed ? "true" : "false",
});

export function MarketsDashboard({
  data,
  refreshing,
  onRefresh,
}: {
  data: MarketsDashboardData;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<MarketFilter>("all");
  const markets = data.status === "available" ? data.markets : [];
  const readyCount = data.status === "available" ? data.readyCount : 0;
  const needsSetupCount = markets.length - readyCount;
  const allReady = markets.length > 0 && needsSetupCount === 0;
  const visibleMarkets = markets.filter(({ ready }) => {
    if (filter === "ready") return ready;
    if (filter === "needs-setup") return !ready;
    return true;
  });

  if (data.status === "available" && !data.marketDrivenShipping) {
    const shippingUrl = new URL("/admin/settings/shipping", data.manageUrl)
      .href;
    return (
      <BorderedCard heading="Markets">
        <s-stack gap="base">
          <s-paragraph>
            This store uses shipping profiles to control which calculated rates
            are available.
          </s-paragraph>
          <s-stack direction="inline" gap="small" justifyContent="end">
            <s-button
              variant="secondary"
              loading={refreshing}
              onClick={onRefresh}
            >
              Refresh
            </s-button>
            <s-button
              variant="secondary"
              href={shippingUrl}
              target="_blank"
              icon="external"
            >
              Open Shipping and delivery
            </s-button>
          </s-stack>
        </s-stack>
      </BorderedCard>
    );
  }

  return (
    <>
      <BorderedCard heading="Markets">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-200">
            {data.status === "available" ? (
              <s-text type="strong">
                ShipFlow is enabled in {readyCount} of {data.totalCount}{" "}
                {data.totalCount === 1 ? "market" : "markets"}
              </s-text>
            ) : (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Market status couldn't be checked</s-text>
                <s-badge tone="warning">Check needed</s-badge>
              </s-stack>
            )}
            <s-paragraph>
              {data.status === "available"
                ? allReady
                  ? "ShipFlow calculated rates can be used in every active market."
                  : "Markets are imported automatically from Shopify. Needs setup means ShipFlow is not active as a carrier-calculated rate provider there."
                : data.reason === "permission"
                  ? "ShipFlow doesn't have permission to read Shopify Markets. Approve Markets access, then refresh."
                  : "Shopify didn't return market status. Your market settings were not changed. Refresh or review them in Shopify."}
            </s-paragraph>
          </s-stack>
          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button
              variant="secondary"
              loading={refreshing}
              disabled={refreshing}
              onClick={onRefresh}
            >
              Refresh
            </s-button>
            <s-button
              commandFor="markets-modal"
              command="--show"
              variant="secondary"
            >
              View markets
            </s-button>
          </s-stack>
        </s-stack>
      </BorderedCard>

      <s-modal id="markets-modal" heading="Markets" size="large">
        {data.status === "available" ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {readyCount} of {data.totalCount}{" "}
              {data.totalCount === 1 ? "market is" : "markets are"} ready to use
              ShipFlow calculated rates.
            </s-paragraph>

            {!allReady ? (
              <s-banner tone="info" heading="How market status works">
                <s-paragraph>
                  Markets appear here automatically; you do not add them in
                  ShipFlow. A market becomes Ready only after ShipFlow's Carrier
                  Service is connected and enabled in that market's Shipping
                  section. If ShipFlow is not offered as a provider, leave the
                  market unchanged and complete Carrier Service setup in
                  ShipFlow first. Then return and choose Refresh.
                </s-paragraph>
                <s-button
                  slot="secondary-actions"
                  href={data.manageUrl}
                  target="_blank"
                  icon="external"
                  variant="secondary"
                >
                  Open Shopify Markets
                </s-button>
              </s-banner>
            ) : null}

            <IndexTableSection label="Markets">
              <IndexTableFilters columns="auto">
                <s-stack direction="inline" gap="small-200">
                  <s-button
                    {...pressedState(filter === "all")}
                    variant={filter === "all" ? "primary" : "secondary"}
                    onClick={() => setFilter("all")}
                  >
                    All ({markets.length})
                  </s-button>
                  <s-button
                    {...pressedState(filter === "ready")}
                    variant={filter === "ready" ? "primary" : "secondary"}
                    onClick={() => setFilter("ready")}
                  >
                    Ready ({readyCount})
                  </s-button>
                  <s-button
                    {...pressedState(filter === "needs-setup")}
                    variant={filter === "needs-setup" ? "primary" : "secondary"}
                    onClick={() => setFilter("needs-setup")}
                  >
                    Needs setup ({needsSetupCount})
                  </s-button>
                </s-stack>
              </IndexTableFilters>
              <IndexTableFilterChips
                filters={
                  filter === "all"
                    ? []
                    : [
                        {
                          label:
                            filter === "ready" ? "Status: Ready" : "Status: Needs setup",
                          onRemove: () => setFilter("all"),
                        },
                      ]
                }
                onClearAll={() => setFilter("all")}
              />
              <s-table-header-row>
                <s-table-header listSlot="primary">Market</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
                <s-table-header listSlot="inline">Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {visibleMarkets.map((market) => (
                  <s-table-row key={market.id}>
                    <s-table-cell>
                      <s-text type="strong">{market.name}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={market.ready ? "success" : "warning"}>
                        {market.ready ? "Ready" : "Needs setup"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        href={market.manageUrl}
                        target="_blank"
                        icon="external"
                        variant="secondary"
                        accessibilityLabel={`Manage ${market.name} in Shopify`}
                      >
                        Manage
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
                <s-empty-state
                  heading={
                    filter === "ready"
                      ? "No ready markets"
                      : filter === "needs-setup"
                        ? "All markets are ready"
                        : "No active markets"
                  }
                >
                  <s-text slot="subheading">
                    {filter === "ready"
                      ? "No market currently has ShipFlow enabled as a carrier-calculated rate provider."
                      : filter === "needs-setup"
                        ? "ShipFlow is enabled in every active market."
                        : "Create or activate a Shopify Market. It will appear here automatically after you refresh."}
                  </s-text>
                </s-empty-state>
              </s-table-body>
            </IndexTableSection>
          </s-stack>
        ) : (
          <s-banner tone="warning" heading="Market status could not be checked">
            <s-paragraph>
              {data.reason === "permission"
                ? "Approve Shopify Markets access when reopening ShipFlow, then refresh."
                : "Shopify didn't return market status. This did not change your market settings. Refresh before editing anything in Shopify."}
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              loading={refreshing}
              disabled={refreshing}
              onClick={onRefresh}
            >
              Refresh
            </s-button>
            <s-button
              slot="secondary-actions"
              href={data.manageUrl}
              target="_blank"
              icon="external"
              variant="secondary"
            >
              Review Shopify Markets
            </s-button>
          </s-banner>
        )}
        {data.status === "available" ? (
          <s-button
            slot="secondary-actions"
            variant="secondary"
            loading={refreshing}
            disabled={refreshing}
            onClick={onRefresh}
          >
            Refresh
          </s-button>
        ) : null}
        <s-button
          slot="primary-action"
          commandFor="markets-modal"
          command="--hide"
          variant="primary"
        >
          Done
        </s-button>
      </s-modal>
    </>
  );
}
