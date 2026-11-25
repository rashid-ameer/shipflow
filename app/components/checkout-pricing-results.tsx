import {
  formatRateAmount,
  type ConditionOutcome,
  type PricingReason,
  type PricingTrace,
} from "../models/calculated-rates";
import {
  formatPlace,
  pricingReasonText,
  type CartSnapshot,
} from "../models/checkout-history";

const conditionLabels: Record<ConditionOutcome, string> = {
  matched: "Matched",
  unmatched: "Did not match",
  missing: "Input unavailable",
  currency: "Different currency",
};
const scenarioLabels = {
  eligible: "Eligible",
  conditions: "Conditions did not match",
  "no-region-rate": "No rate for this region",
  currency: "Different currency",
  inactive: "Inactive",
};
const selectionLabels = {
  all: "All eligible rates",
  lowest: "Lowest price",
  highest: "Highest price",
  priority: "First by priority",
};
const roundingLabels = {
  none: "No rounding",
  ceil: "Round up",
  floor: "Round down",
  "nearest-one": "Nearest whole unit",
  "nearest-half": "Nearest half unit",
};

function money(amount: number, currency: string) {
  return `${formatRateAmount(amount, currency)} ${currency}`;
}

export function CheckoutPricingResults({
  reason,
  trace,
  rateCount,
}: {
  reason: string;
  trace: PricingTrace | null;
  rateCount: number;
}) {
  const summary = Object.prototype.hasOwnProperty.call(pricingReasonText, reason)
    ? pricingReasonText[reason as PricingReason]
    : "Checkout pricing outcome unavailable.";
  return (
    <s-section heading="Rates">
      <s-stack gap="base">
        {rateCount > 0 ? (
          <s-stack direction="inline">
            <s-badge tone="success">
              {rateCount} {rateCount === 1 ? "rate" : "rates"} returned
            </s-badge>
          </s-stack>
        ) : (
          <s-banner
            tone={reason === "evaluation-error" ? "critical" : "info"}
            heading="No rates returned"
          >
            <s-paragraph>{summary}</s-paragraph>
          </s-banner>
        )}
        {trace ? (
          <>
            <s-paragraph>
              Matched region: {trace.region?.name ?? "None"}
            </s-paragraph>
            {trace.scenarios.length > 0 ? (
              <s-stack gap="small">
                <s-heading>Scenarios evaluated</s-heading>
                {trace.scenarios.map((scenario, index) => (
                  <s-box
                    key={scenario.id ?? index}
                    padding="base"
                    border="base"
                    borderRadius="base"
                  >
                    <s-stack gap="small">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        gap="small"
                      >
                        <s-text>{scenario.name}</s-text>
                        <s-badge
                          tone={
                            scenario.outcome === "eligible"
                              ? "success"
                              : "neutral"
                          }
                        >
                          {scenarioLabels[scenario.outcome]}
                        </s-badge>
                      </s-stack>
                      {scenario.conditions.map((condition, position) => (
                        <s-stack
                          key={position}
                          direction="inline"
                          justifyContent="space-between"
                          gap="small"
                        >
                          <s-text>
                            {condition.title} · {condition.expected}
                          </s-text>
                          <s-badge
                            tone={
                              condition.outcome === "matched"
                                ? "success"
                                : "warning"
                            }
                          >
                            {conditionLabels[condition.outcome]}
                          </s-badge>
                        </s-stack>
                      ))}
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            ) : null}
            {trace.rates.length ? (
              <s-stack gap="small">
                <s-heading>Price breakdown</s-heading>
                <s-paragraph>
                  {selectionLabels[trace.selection]} ·{" "}
                  {roundingLabels[trace.rounding]}
                </s-paragraph>
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">
                      Shipping rate
                    </s-table-header>
                    <s-table-header listSlot="labeled">Scenario</s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">
                      Fixed price
                    </s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">
                      Final price
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {trace.rates.map((rate) => (
                      <s-table-row key={rate.id}>
                        <s-table-cell>{rate.name}</s-table-cell>
                        <s-table-cell>{rate.scenario}</s-table-cell>
                        <s-table-cell>
                          {money(rate.amount, rate.currency)}
                        </s-table-cell>
                        <s-table-cell>
                          {rate.finalAmount === null
                            ? "Not selected"
                            : money(rate.finalAmount, rate.currency)}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              </s-stack>
            ) : null}
          </>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export function CheckoutCartDetails({ snapshot }: { snapshot: CartSnapshot }) {
  return (
    <s-section heading="Cart details">
      <s-stack gap="base">
        <s-stack gap="small">
          <s-text>Destination: {formatPlace(snapshot.destination)}</s-text>
          <s-text>Ship from: {formatPlace(snapshot.origin ?? null)}</s-text>
          <s-text>
            Cart subtotal before discounts:{" "}
            {money(snapshot.subtotal, snapshot.currency)}
          </s-text>
          <s-text>Shipping quantity: {snapshot.quantity}</s-text>
          <s-text>
            Shipping weight:{" "}
            {snapshot.grams === null ? "Unavailable" : `${snapshot.grams} g`}
          </s-text>
          {snapshot.locale ? (
            <s-text>Checkout language: {snapshot.locale}</s-text>
          ) : null}
        </s-stack>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Item</s-table-header>
            <s-table-header listSlot="labeled" format="numeric">
              Quantity
            </s-table-header>
            <s-table-header listSlot="labeled" format="numeric">
              Unit price
            </s-table-header>
            <s-table-header listSlot="labeled" format="numeric">
              Unit weight
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {snapshot.lines.map((line, index) => (
              <s-table-row key={index}>
                <s-table-cell>
                  {line.name ??
                    (line.variantId
                      ? `Variant ${line.variantId}`
                      : "Unnamed item")}
                </s-table-cell>
                <s-table-cell>{line.quantity}</s-table-cell>
                <s-table-cell>
                  {money(line.price, snapshot.currency)}
                </s-table-cell>
                <s-table-cell>
                  {line.grams === null ? "Unavailable" : `${line.grams} g`}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {snapshot.extraLines ? (
          <s-paragraph>
            {snapshot.extraLines} additional items were included in pricing.
          </s-paragraph>
        ) : null}
      </s-stack>
    </s-section>
  );
}
