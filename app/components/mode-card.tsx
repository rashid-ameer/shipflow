import { BorderedCard } from "./bordered-card";
import type { ReactNode } from "react";

type ModeCardProps = {
  status?: ReactNode;
  action: ReactNode;
};

export function DeliveryCustomizationCard({ status, action }: ModeCardProps) {
  return (
    <BorderedCard heading="Delivery Customization">
      <s-stack direction="block" gap="base">
        {status}
        <s-paragraph>
          Change the delivery methods Shopify already shows at checkout.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Hide, show, rename, reorder, and sort methods</s-list-item>
          <s-list-item>Works without Carrier Calculated Shipping</s-list-item>
          <s-list-item>Test changes in a real checkout</s-list-item>
        </s-unordered-list>
        <s-paragraph>
          Works on Shopify Basic and up. This card selects functionality only;
          it does not start a plan or subscription.
        </s-paragraph>
        {action}
      </s-stack>
    </BorderedCard>
  );
}

export function CcsRatesCard({ status, action }: ModeCardProps) {
  return (
    <BorderedCard heading="CCS Rates">
      <s-stack direction="block" gap="base">
        {status}
        <s-paragraph>
          Calculate and return new shipping prices at checkout.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Scenarios, regions, and flexible rate types</s-list-item>
          <s-list-item>Combined rates and optional live carriers</s-list-item>
          <s-list-item>Simulator, History, and product dimensions</s-list-item>
        </s-unordered-list>
        <s-paragraph>
          Requires Carrier Calculated Shipping on the Shopify store. This card
          selects functionality only; it does not start a plan or subscription.
        </s-paragraph>
        {action}
      </s-stack>
    </BorderedCard>
  );
}
