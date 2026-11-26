import { BorderedCard } from "../components/bordered-card";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { MarketsDashboard } from "../components/markets-dashboard";
import prisma from "../db.server";
import { ratesPaths } from "../models/calculated-rates";
import { getCarrierSetup } from "../models/carrier-shopify.server";
import { getMarketsDashboardData } from "../models/market-readiness.server";
import { deliveryPaths } from "../models/delivery-customization";
import {
  changeDeliveryRuntime,
  getDeliveryRules,
  getDeliveryStatus,
  syncErrorMessage,
} from "../models/delivery-customization.server";
import {
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  OperatingMode,
  parseOperatingMode,
  setTestMode,
  switchOperatingMode,
} from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || !store.mode) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }

  const [markets, delivery, rates] = await Promise.all([
    getMarketsDashboardData(
      (query) => admin.graphql(query),
      session.shop,
      undefined,
      store.carrierServiceId,
    ),
    store.mode === OperatingMode.DELIVERY_CUSTOMIZATION
      ? getDeliveryRules(store.id).then(async (rules) => {
          if (rules.length === 0) return { total: 0, active: 0 };
          const status = await getDeliveryStatus(admin.graphql, rules, store);
          return {
            total: rules.length,
            active: status.issue
              ? null
              : Object.values(status.states).filter(
                  (state) => state === "active",
                ).length,
          };
        })
      : null,
    store.mode === OperatingMode.CCS_RATES
      ? Promise.all([
          prisma.rateScenario.count({ where: { storeId: store.id } }),
          prisma.rateScenario.count({
            where: { storeId: store.id, active: true, rates: { some: {} } },
          }),
          prisma.carrierRequest.count({
            where: { storeId: store.id, testIdentity: "test" },
          }),
          getCarrierSetup(admin.graphql, store),
        ]).then(([scenarios, active, tests, setup]) => ({
          scenarios,
          active,
          tests,
          setup,
        }))
      : null,
  ]);

  return {
    mode:
      store.mode === OperatingMode.CCS_RATES
        ? ("ccs-rates" as const)
        : ("delivery-customization" as const),
    testMode: store.testMode,
    appEnabled: store.appEnabled,
    ccsNeedsAttention: !rates?.setup.connected,
    markets,
    delivery,
    rates,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "go-live") {
    try {
      await setTestMode(session.shop, false);
      return { ok: true as const, intent: "go-live" as const, error: null };
    } catch (error) {
      return data(
        {
          ok: false as const,
          error:
            error instanceof Response
              ? "Go Live is available only in CCS Rates mode."
              : "Test Mode is still on. Try again.",
        },
        { status: error instanceof Response ? error.status : 500 },
      );
    }
  }
  if (intent !== "switch-mode") {
    return data(
      {
        ok: false as const,
        intent: "unknown" as const,
        error: "Unknown dashboard action.",
      },
      { status: 400 },
    );
  }
  const mode = parseOperatingMode(formData.get("mode"));
  if (!mode) {
    return data(
      {
        ok: false as const,
        intent: "switch-mode" as const,
        error: "Choose a valid operating mode.",
      },
      { status: 400 },
    );
  }
  try {
    await changeDeliveryRuntime(admin.graphql, session.shop, { mode }, (tx) =>
      switchOperatingMode(session.shop, mode, tx),
    );
  } catch (error) {
    return data(
      {
        ok: false as const,
        intent: "switch-mode" as const,
        error: syncErrorMessage(error),
      },
      { status: 422 },
    );
  }
  return {
    ok: true as const,
    intent: "switch-mode" as const,
    error: null,
  };
}

export default function Dashboard() {
  const dashboard = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const switcher = useFetcher<typeof action>();
  const goLiveFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const switchModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const goLiveModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const [targetMode, setTargetMode] = useState<
    "delivery-customization" | "ccs-rates" | null
  >(null);
  const [testBannerHidden, setTestBannerHidden] = useState(false);
  const isCcs = dashboard.mode === "ccs-rates";
  const switching = switcher.state !== "idle";
  const goingLive = goLiveFetcher.state !== "idle";
  const refreshingMarkets = revalidator.state !== "idle";
  const readyMarketCount =
    dashboard.markets.status === "available" ? dashboard.markets.readyCount : 0;

  useEffect(() => {
    setTestBannerHidden(false);
  }, [dashboard.testMode, dashboard.mode]);

  useEffect(() => {
    if (goLiveFetcher.state !== "idle" || !goLiveFetcher.data?.ok) return;
    goLiveModalRef.current?.hideOverlay();
    shopify.toast.show("Test Mode turned off");
  }, [goLiveFetcher.state, goLiveFetcher.data, shopify]);

  const requestSwitch = (mode: "delivery-customization" | "ccs-rates") => {
    setTargetMode(mode);
    switchModalRef.current?.showOverlay();
  };

  const confirmSwitch = () => {
    if (!targetMode) return;
    switcher.submit(
      { intent: "switch-mode", mode: targetMode },
      { method: "post" },
    );
    switchModalRef.current?.hideOverlay();
  };

  const confirmGoLive = () => {
    goLiveFetcher.submit({ intent: "go-live" }, { method: "post" });
  };

  const currentModeLabel = isCcs ? "CCS Rates" : "Delivery Customization";
  const alternateMode = isCcs ? "delivery-customization" : "ccs-rates";
  const alternateModeLabel = isCcs ? "Delivery Customization" : "CCS Rates";

  return (
    <s-page heading="Home">
      <s-stack direction="block" gap="base">
        <s-box paddingBlockEnd="small">
          <s-stack direction="inline" gap="small-200">
            <s-badge tone={isCcs ? "info" : "success"}>
              {currentModeLabel}
            </s-badge>
            {isCcs ? (
              <s-badge tone={dashboard.testMode ? "warning" : "success"}>
                {dashboard.testMode ? "Test" : "Live"}
              </s-badge>
            ) : null}
            <s-badge tone={dashboard.appEnabled ? "success" : "critical"}>
              {dashboard.appEnabled ? "Enabled" : "Disabled"}
            </s-badge>
          </s-stack>
        </s-box>

        <MarketsDashboard
          data={dashboard.markets}
          refreshing={refreshingMarkets}
          onRefresh={() => revalidator.revalidate()}
        />

        {isCcs &&
        dashboard.appEnabled &&
        dashboard.testMode &&
        !testBannerHidden ? (
          <s-banner
            tone="info"
            heading="Test Mode is on"
            dismissible
            onDismiss={() => setTestBannerHidden(true)}
          >
            <s-paragraph>
              Only requests where Shopify supplies{" "}
              <s-text type="strong">shipflow</s-text> as the customer first name
              can receive calculated rates. Change the cart or destination when
              comparing tests so Shopify requests fresh rates.
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              disabled={goingLive || switching}
              onClick={() => goLiveModalRef.current?.showOverlay()}
            >
              Go Live
            </s-button>
          </s-banner>
        ) : null}

        {isCcs && dashboard.ccsNeedsAttention ? (
          <s-banner
            tone="warning"
            heading="Calculated shipping needs attention"
          >
            <s-paragraph>
              Connect the Carrier Service and add ShipFlow to Shopify’s shipping
              setup before expecting rates at checkout.
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              href={ratesPaths.hub}
              variant="secondary"
            >
              Open calculated shipping setup
            </s-button>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              onClick={() => requestSwitch("delivery-customization")}
            >
              Switch to Delivery Customization
            </s-button>
          </s-banner>
        ) : null}

        {switcher.data && !switcher.data.ok ? (
          <s-banner tone="critical" heading="The mode was not changed">
            <s-paragraph>{switcher.data.error}</s-paragraph>
          </s-banner>
        ) : null}

        <BorderedCard heading="Setup checklist" id="setup-checklist">
          <s-stack direction="block" gap="base">
            {isCcs ? (
              <>
                <ChecklistItem
                  label="Verify Carrier Calculated Shipping"
                  done={!dashboard.ccsNeedsAttention}
                />
                <ChecklistItem
                  label="Add ShipFlow to Shopify shipping"
                  done={
                    dashboard.markets.status === "available" &&
                    dashboard.markets.marketDrivenShipping
                      ? readyMarketCount > 0
                      : Boolean(dashboard.rates?.setup.profileAttached)
                  }
                  href={ratesPaths.hub}
                />
                <ChecklistItem
                  label="Create a scenario"
                  done={Boolean(dashboard.rates?.scenarios)}
                  href={ratesPaths.scenario("new")}
                />
                <ChecklistItem
                  label="Test in checkout"
                  done={Boolean(dashboard.rates?.tests)}
                  href={ratesPaths.hub}
                />
              </>
            ) : (
              <>
                <ChecklistItem
                  label="Create a customization"
                  done={Boolean(dashboard.delivery?.total)}
                  href={deliveryPaths.create}
                />
                <ChecklistItem label="Test in checkout" done={false} />
              </>
            )}
          </s-stack>
        </BorderedCard>

        {dashboard.delivery ? (
          <BorderedCard heading="Delivery customizations">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base">
                <s-text>{dashboard.delivery.total} saved</s-text>
                <s-text>
                  {dashboard.delivery.active === null
                    ? "Checkout status unavailable"
                    : `${dashboard.delivery.active} active at checkout`}
                </s-text>
              </s-stack>
              <s-paragraph>
                Shopify allows up to 25 active delivery customizations per store
                across all apps.
              </s-paragraph>
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  variant="secondary"
                  href={
                    dashboard.delivery.total > 0
                      ? deliveryPaths.list
                      : deliveryPaths.create
                  }
                >
                  View
                </s-button>
              </s-stack>
            </s-stack>
          </BorderedCard>
        ) : (
          <BorderedCard heading="Activity">
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 180px), 1fr))"
              gap="base"
            >
              <Metric
                label="Scenarios"
                value={String(dashboard.rates?.scenarios ?? 0)}
              />
              <Metric
                label="Active scenarios with rates"
                value={String(dashboard.rates?.active ?? 0)}
              />
              <Metric
                label="Checkout tests"
                value={String(dashboard.rates?.tests ?? 0)}
              />
            </s-grid>
          </BorderedCard>
        )}

        <BorderedCard heading="Operating mode">
          <s-box padding="base" border="base base solid" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {currentModeLabel} is the selected operating mode.
              </s-paragraph>
              <s-stack direction="inline">
                <s-button
                  variant="secondary"
                  disabled={goingLive || switching}
                  onClick={() => requestSwitch(alternateMode)}
                >
                  Switch to {alternateModeLabel}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </BorderedCard>
      </s-stack>

      <s-modal
        id="switch-mode-modal"
        ref={switchModalRef as never}
        heading={
          targetMode === "ccs-rates"
            ? "Switch to CCS Rates?"
            : "Switch to Delivery Customization?"
        }
      >
        <s-paragraph>
          Only one mode runs at checkout. Existing rules in the inactive mode
          stay saved and can resume when you switch back.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="switch-mode-modal"
          command="--hide"
          variant="secondary"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={switching}
          disabled={switching || targetMode === null}
          onClick={confirmSwitch}
        >
          Confirm switch
        </s-button>
      </s-modal>

      <s-modal
        id="go-live-modal"
        ref={goLiveModalRef as never}
        heading="Go live with CCS Rates?"
      >
        <s-stack direction="block" gap="base">
          {goLiveFetcher.state === "idle" &&
          goLiveFetcher.data &&
          !goLiveFetcher.data.ok ? (
            <s-banner tone="critical" heading="Could not go live">
              <s-paragraph>{goLiveFetcher.data.error}</s-paragraph>
            </s-banner>
          ) : null}
          <s-paragraph>
            Test Mode will turn off. Eligible customer checkouts can receive
            ShipFlow rates after Carrier Calculated Shipping and the market's
            shipping setup are ready.
          </s-paragraph>
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="go-live-modal"
          command="--hide"
          variant="secondary"
          disabled={goingLive}
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={goingLive}
          disabled={goingLive}
          onClick={confirmGoLive}
        >
          Confirm Go Live
        </s-button>
      </s-modal>
    </s-page>
  );
}

function ChecklistItem({
  label,
  done,
  href,
}: {
  label: string;
  done: boolean;
  href?: string;
}) {
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
      <s-badge tone={done ? "success" : "neutral"}>
        {done ? "Done" : "Next"}
      </s-badge>
      {href && !done ? (
        <s-link href={href}>{label}</s-link>
      ) : (
        <s-text>{label}</s-text>
      )}
    </s-grid>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" border="base base solid" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text tone="neutral" color="subdued">
          {label}
        </s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}
