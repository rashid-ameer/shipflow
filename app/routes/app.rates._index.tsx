import { BorderedCard } from "../components/bordered-card";
import {
  data,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import { ratesPaths } from "../models/calculated-rates";
import { combinedPaths } from "../models/combined-rates";
import { requireRatesStore } from "../models/rates-access.server";
import {
  carrierErrorDetails,
  connectCarrierService,
  getCarrierSetup,
} from "../models/carrier-shopify.server";
import { getMarketsDashboardData } from "../models/market-readiness.server";
import { diagnosticsPaths } from "../models/checkout-history";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  const [setup, markets, scenarios] = await Promise.all([
    getCarrierSetup(admin.graphql, store),
    getMarketsDashboardData(
      admin.graphql,
      store.shopDomain,
      undefined,
      store.carrierServiceId,
    ),
    prisma.rateScenario.count({ where: { storeId: store.id } }),
  ]);
  return {
    ...setup,
    scenarios,
    markets,
    shippingUrl: `https://${store.shopDomain}/admin/settings/shipping`,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, store } = await requireRatesStore(request, true);
  const form = await request.formData();
  if (form.get("intent") !== "connect")
    return data(
      { ok: false as const, error: "Unknown action.", ccsUnavailable: false },
      { status: 400 },
    );
  try {
    await connectCarrierService(admin.graphql, store.shopDomain);
    return { ok: true as const };
  } catch (error) {
    return data(
      { ok: false as const, ...carrierErrorDetails(error) },
      { status: 422 },
    );
  }
}

export default function RatesHub() {
  const state = useLoaderData<typeof loader>();
  const connect = useFetcher<typeof action>();
  const busy = connect.state !== "idle";
  const marketsShipping =
    state.markets.status === "available" && state.markets.marketDrivenShipping;
  const ready =
    state.connected &&
    (marketsShipping
      ? state.markets.status === "available" && state.markets.readyCount > 0
      : state.profileAttached);
  return (
    <s-page heading="Rates">
      <s-button slot="secondary-actions" href={diagnosticsPaths.simulator}>
        Open simulator
      </s-button>
      <s-stack gap="base">
        {connect.data && !connect.data.ok ? (
          <s-banner
            tone="critical"
            heading="Calculated shipping could not be connected"
          >
            <s-paragraph>{connect.data.error}</s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              href={
                connect.data.ccsUnavailable
                  ? "https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/third-party-carrier-calculated-shipping/carrier-accounts"
                  : state.shippingUrl
              }
              target="_blank"
              icon="external"
            >
              {connect.data.ccsUnavailable
                ? "Check CCS availability"
                : "Open Shipping and delivery"}
            </s-button>
          </s-banner>
        ) : null}
        {!state.connected ? (
          <s-banner tone="warning" heading="Connect calculated shipping">
            <s-paragraph>
              {state.issue ??
                "Connect ShipFlow to Shopify before activating scenarios. You can prepare drafts now."}
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              loading={busy}
              disabled={busy}
              onClick={() =>
                connect.submit({ intent: "connect" }, { method: "post" })
              }
            >
              Connect Carrier Service
            </s-button>
          </s-banner>
        ) : !ready ? (
          <s-banner tone="warning" heading="Finish setup in Shopify">
            <s-paragraph>
              Add ShipFlow as a carrier-calculated rate provider for the
              shipping destinations you want to serve.
            </s-paragraph>
            {state.issue ? <s-paragraph>{state.issue}</s-paragraph> : null}
            <s-button
              slot="secondary-actions"
              variant="secondary"
              href={
                marketsShipping ? state.markets.manageUrl : state.shippingUrl
              }
              target="_blank"
              icon="external"
            >
              {marketsShipping
                ? "Open Shopify Markets"
                : "Open Shipping and delivery"}
            </s-button>
          </s-banner>
        ) : null}
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 280px), 1fr))"
          gap="base"
        >
          <BorderedCard heading="Scenarios">
            <s-paragraph>
              {state.scenarios} saved. Use conditions and regions to decide when
              a shipping rate appears.
            </s-paragraph>
            <s-button variant="secondary" href={ratesPaths.scenarios}>
              View scenarios
            </s-button>
          </BorderedCard>
          <BorderedCard heading="Combined shipping rates">
            <s-paragraph>
              Use shipping tags to merge matching scenario rates into one
              checkout option.
            </s-paragraph>
            <s-button variant="secondary" href={combinedPaths.list}>
              View combined rates
            </s-button>
          </BorderedCard>
        </s-grid>
      </s-stack>
    </s-page>
  );
}
