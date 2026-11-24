import { useEffect, useRef, useState } from "react";
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
import { getMarketsDashboardData } from "../models/market-readiness.server";
import {
  ccsNeedsAttention,
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  OperatingMode,
  parseOperatingMode,
  switchOperatingMode,
} from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || !store.mode) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }

  const markets = await getMarketsDashboardData(
    (query) => admin.graphql(query),
    session.shop,
  );

  return {
    mode:
      store.mode === OperatingMode.CCS_RATES
        ? ("ccs-rates" as const)
        : ("delivery-customization" as const),
    testMode: store.testMode,
    ccsNeedsAttention: ccsNeedsAttention(store.ccsStatus),
    settings: store.settings,
    markets,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "switch-mode") {
    return data({ ok: false, error: "Unknown dashboard action." }, { status: 400 });
  }
  const mode = parseOperatingMode(formData.get("mode"));
  if (!mode) {
    return data({ ok: false, error: "Choose a valid operating mode." }, { status: 400 });
  }
  await switchOperatingMode(session.shop, mode);
  return { ok: true, error: null };
}

export default function Dashboard() {
  const dashboard = useLoaderData<typeof loader>();
  const switcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const switchModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const [targetMode, setTargetMode] = useState<
    "delivery-customization" | "ccs-rates" | null
  >(null);
  const [testBannerHidden, setTestBannerHidden] = useState(false);
  const isCcs = dashboard.mode === "ccs-rates";
  const switching = switcher.state !== "idle";
  const refreshingMarkets = revalidator.state !== "idle";
  const readyMarketCount =
    dashboard.markets.status === "available"
      ? dashboard.markets.readyCount
      : 0;

  useEffect(() => {
    setTestBannerHidden(false);
  }, [dashboard.testMode, dashboard.mode]);

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

  const currentModeLabel = isCcs ? "CCS Rates" : "Delivery Customization";
  const alternateMode = isCcs ? "delivery-customization" : "ccs-rates";
  const alternateModeLabel = isCcs ? "Delivery Customization" : "CCS Rates";

  return (
    <s-page heading="Home" inlineSize="base">
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
          </s-stack>
        </s-box>

        <MarketsDashboard
          data={dashboard.markets}
          refreshing={refreshingMarkets}
          onRefresh={() => revalidator.revalidate()}
        />

        {isCcs && dashboard.testMode && !testBannerHidden ? (
          <s-banner
            tone="info"
            heading="Test Mode is on"
            dismissible
            onDismiss={() => setTestBannerHidden(true)}
          >
            <s-paragraph>
              Calculated rates are intended only for test checkouts using
              shipflow as the customer first name. Going live is part of the next
              settings milestone.
            </s-paragraph>
          </s-banner>
        ) : null}

        {isCcs && dashboard.ccsNeedsAttention ? (
          <s-banner tone="warning" heading="Calculated shipping needs attention">
            <s-paragraph>
              ShipFlow has not verified Carrier Calculated Shipping for this
              store. Rate creation and checkout activation remain unavailable
              until the store and shipping profile are ready.
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              href="https://admin.shopify.com/settings/shipping"
              target="_blank"
              icon="external"
              variant="secondary"
            >
              Enable CCS
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

        <s-section heading="Setup checklist" id="setup-checklist">
          <s-stack direction="block" gap="base">
            {isCcs ? (
              <>
                <ChecklistItem
                  label="Verify Carrier Calculated Shipping"
                  done={!dashboard.ccsNeedsAttention}
                />
                <ChecklistItem
                  label="Enable ShipFlow in a Shopify market"
                  done={readyMarketCount > 0}
                />
                <ChecklistItem label="Create a scenario" done={false} />
                <ChecklistItem label="Test in checkout" done={false} />
              </>
            ) : (
              <>
                <ChecklistItem label="Create a customization" done={false} />
                <ChecklistItem label="Test in checkout" done={false} />
              </>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Activity">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
            gap="base"
          >
            <Metric label={isCcs ? "Scenarios" : "Customizations"} value="0" />
            <Metric label="Active rules" value="0" />
            <Metric label="Checkout tests" value="0" />
          </s-grid>
        </s-section>

        <s-section heading="Operating mode">
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Current mode</s-text>
                <s-badge tone={isCcs ? "info" : "success"}>
                  {currentModeLabel}
                </s-badge>
              </s-stack>
              <s-paragraph>
                You are currently using {currentModeLabel} at checkout.
              </s-paragraph>
              <s-stack direction="inline">
                <s-button
                  variant="secondary"
                  onClick={() => requestSwitch(alternateMode)}
                >
                  Switch to {alternateModeLabel}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
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
    </s-page>
  );
}

function ChecklistItem({ label, done }: { label: string; done: boolean }) {
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
      <s-badge tone={done ? "success" : "neutral"}>
        {done ? "Done" : "Next"}
      </s-badge>
      <s-text>{label}</s-text>
    </s-grid>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text tone="neutral" color="subdued">
          {label}
        </s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}
