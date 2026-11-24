import {
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";

import {
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  OperatingMode,
} from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || !store.mode) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }
  return {
    mode:
      store.mode === OperatingMode.CCS_RATES
        ? "CCS Rates"
        : "Delivery Customization",
    settings: store.settings,
  };
}

export default function SettingsOverview() {
  const { mode, settings } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Settings" inlineSize="base">
      <s-stack direction="block" gap="base">
        <s-section heading="Current setup">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-text type="strong">Operating mode: </s-text>
              {mode}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Measurement defaults: </s-text>
              {settings.weightUnit}, {settings.distanceUnit},{" "}
              {settings.dimensionUnit}
            </s-paragraph>
            <s-paragraph>
              <s-text type="strong">Volumetric divisor: </s-text>
              {settings.volumetricDivisor}
            </s-paragraph>
          </s-stack>
        </s-section>
        <s-banner tone="info" heading="Settings editing comes next">
          <s-paragraph>
            Milestone 2 connects these values to editable settings, Test Mode,
            and the Go Live confirmation. The values shown here already persist
            per shop.
          </s-paragraph>
        </s-banner>
        <s-stack direction="inline" justifyContent="end">
          <s-button href="/app" variant="secondary">
            Back to Home
          </s-button>
        </s-stack>
      </s-stack>
    </s-page>
  );
}
