import { useEffect, useRef, useState } from "react";
import {
  data,
  redirect,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import {
  CcsRatesCard,
  DeliveryCustomizationCard,
} from "../components/mode-card";
import {
  completeOnboarding,
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  parseOperatingMode,
} from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (
    store.onboardingStep === OnboardingStep.WELCOME ||
    store.onboardingStep === OnboardingStep.UNITS
  ) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }
  if (store.onboardingStep === OnboardingStep.COMPLETE) throw redirect("/app");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (
    store.onboardingStep === OnboardingStep.WELCOME ||
    store.onboardingStep === OnboardingStep.UNITS
  ) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }
  if (store.onboardingStep === OnboardingStep.COMPLETE) throw redirect("/app");
  const mode = parseOperatingMode((await request.formData()).get("mode"));
  if (!mode) return data({ error: "Choose an operating mode." }, { status: 400 });
  await completeOnboarding(session.shop, mode);
  return redirect("/app");
}

export default function OnboardingMode() {
  const navigation = useNavigation();
  const submit = useSubmit();
  const confirmModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const [selectedMode, setSelectedMode] = useState<
    "delivery-customization" | "ccs-rates" | null
  >(null);
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (selectedMode) confirmModalRef.current?.showOverlay();
  }, [selectedMode]);

  const confirmMode = () => {
    if (!selectedMode) return;
    submit({ mode: selectedMode }, { method: "post" });
  };

  const chooseButton = (mode: "delivery-customization" | "ccs-rates") => (
    <s-button
      variant="primary"
      disabled={submitting}
      onClick={() => setSelectedMode(mode)}
    >
      {mode === "ccs-rates"
        ? "Use CCS Rates"
        : "Use Delivery Customization"}
    </s-button>
  );

  return (
    <s-page heading="Choose an operating mode" inlineSize="base">
      <s-stack direction="block" gap="base">
        <s-banner tone="info" heading="CCS Rates starts in Test Mode">
          <s-paragraph>
            To see ShipFlow rates, enter “shipflow” as the customer's first name
            in a test checkout. Regular customer checkouts are not affected.
          </s-paragraph>
        </s-banner>
        <s-banner
          tone="info"
          heading="CCS Rates requires Carrier Calculated Shipping"
        >
          <s-paragraph>
            Carrier Calculated Shipping (CCS) lets Shopify send checkout details
            to ShipFlow and display the shipping rates ShipFlow returns.
          </s-paragraph>
          <s-paragraph>
            Availability depends on the store's Shopify plan and shipping setup.
            Choosing CCS Rates here does not change the store's plan.
          </s-paragraph>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            href="https://admin.shopify.com/settings/shipping"
            target="_blank"
            icon="external"
          >
            Open Shopify shipping settings
          </s-button>
        </s-banner>

        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 280px), 1fr))"
          gap="base"
        >
          <DeliveryCustomizationCard
            action={chooseButton("delivery-customization")}
          />
          <CcsRatesCard action={chooseButton("ccs-rates")} />
        </s-grid>
        <s-stack direction="inline" justifyContent="end">
          <s-button href="/app/onboarding/units" variant="secondary">
            Back
          </s-button>
        </s-stack>
      </s-stack>

      <s-modal
        id="confirm-onboarding-mode"
        ref={confirmModalRef as never}
        onHide={() => setSelectedMode(null)}
        heading={
          selectedMode === "ccs-rates"
            ? "Use CCS Rates?"
            : "Use Delivery Customization?"
        }
      >
        <s-paragraph>
          {selectedMode === "ccs-rates"
            ? "CCS Rates will become the active mode. Test Mode will be enabled so you can verify ShipFlow rates before showing them to customers."
            : "Delivery Customization will become the active mode for checkout."}
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="confirm-onboarding-mode"
          command="--hide"
          variant="secondary"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={submitting}
          disabled={submitting || selectedMode === null}
          onClick={confirmMode}
        >
          Confirm mode
        </s-button>
      </s-modal>
    </s-page>
  );
}
