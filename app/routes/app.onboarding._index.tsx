import { BorderedCard } from "../components/bordered-card";
import {
  redirect,
  type LoaderFunctionArgs,
} from "react-router";

import {
  getOrCreateShop,
  OnboardingStep,
} from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep === OnboardingStep.COMPLETE) throw redirect("/app");
  return null;
}

export default function OnboardingWelcome() {
  return (
    <s-page heading="Welcome to ShipFlow" inlineSize="base">
      <BorderedCard heading="What you can do">
        <s-stack direction="block" gap="base">
          <s-box padding="base" border="base base solid" borderRadius="base">
            <s-heading>Customize delivery options</s-heading>
            <s-paragraph>
              Hide, show, rename, reorder, or sort methods Shopify already
              shows. Carrier Calculated Shipping is not required.
            </s-paragraph>
          </s-box>
          <s-box padding="base" border="base base solid" borderRadius="base">
            <s-heading>Calculate custom shipping rates</s-heading>
            <s-paragraph>
              Return your own prices using cart, product, customer, distance,
              and dimension conditions.
            </s-paragraph>
          </s-box>
          <s-box padding="base" border="base base solid" borderRadius="base">
            <s-heading>Test and explain results</s-heading>
            <s-paragraph>
              Use Test Mode first, then verify calculated rates with Simulator
              and History as those tools become available.
            </s-paragraph>
          </s-box>
          <s-stack direction="inline" justifyContent="end">
            <s-button variant="primary" href="/app/onboarding/units">
              Next step
            </s-button>
          </s-stack>
        </s-stack>
      </BorderedCard>
    </s-page>
  );
}
