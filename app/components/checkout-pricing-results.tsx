import { BorderedCard } from "./bordered-card";
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
import { combinationMethods } from "../models/combined-rates";

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
  "no-priced-rate": "No eligible price",
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
const rejectedLabels = {
  inactive: "Rate is inactive",
  "no-products": "No products matched the filter",
  "no-package": "No suitable package was found",
  "missing-input": "Required product or cart data is unavailable",
  "no-tier": "No tier matched the pricing value",
  "amount-limit": "Calculated amount is outside the supported range",
  "carrier-unavailable": "Carrier service unavailable",
};
const combinationReasons = {
  "missing-tags": "Required shipping tags are missing",
  "two-tags": "Fewer than two tags matched",
  blocked: "A blocking tag is present",
  excluded: "All matching rates have excluded tags",
  "amount-limit": "The combined amount exceeds the supported limit",
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
  const summary = Object.prototype.hasOwnProperty.call(
    pricingReasonText,
    reason,
  )
    ? pricingReasonText[reason as PricingReason]
    : "Checkout pricing outcome unavailable.";
  return (
    <BorderedCard heading="Rates">
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
            {reason === "store-fallback" ? (
              <s-paragraph>{summary}</s-paragraph>
            ) : null}
            {trace.distanceError ? (
              <s-banner tone="warning">{trace.distanceError}</s-banner>
            ) : null}
            {trace.distanceMeters !== undefined ? (
              <s-paragraph>
                Driving distance ·{" "}
                {new Intl.NumberFormat("en", {
                  maximumFractionDigits: 3,
                }).format(trace.distanceMeters / 1000)}{" "}
                km
              </s-paragraph>
            ) : null}
            {trace.pricingSubtotal !== undefined && trace.pricingCurrency ? (
              <s-paragraph>
                Pricing subtotal after discounts ·{" "}
                {money(trace.pricingSubtotal, trace.pricingCurrency)}
              </s-paragraph>
            ) : null}
            {trace.scenarios.length > 0 ? (
              <s-stack gap="small">
                <s-heading>Scenarios evaluated</s-heading>
                {trace.scenarios.map((scenario, index) => (
                  <s-box
                    key={scenario.id ?? index}
                    padding="base"
                    border="base base solid"
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
            {trace.combinations?.length ? (
              <s-stack gap="small">
                <s-heading>Combined rates</s-heading>
                {trace.combinations.map((step) => (
                  <s-box
                    key={step.ruleId}
                    border="base base solid"
                    padding="base"
                    borderRadius="base"
                  >
                    <s-stack gap="small">
                      <s-text type="strong">
                        {step.ruleName} · {combinationMethods[step.method]}
                      </s-text>
                      {"reason" in step ? (
                        <s-text>
                          {combinationReasons[step.reason]}
                          {step.tags?.length
                            ? ` · ${step.tags.join(", ")}`
                            : ""}
                        </s-text>
                      ) : (
                        <>
                          <s-unordered-list>
                            {step.sources.map((rate) => (
                              <s-list-item key={rate.id}>
                                {rate.name} ·{" "}
                                {money(rate.amount, step.currency)}
                              </s-list-item>
                            ))}
                          </s-unordered-list>
                          <s-text>
                            {step.name} · {money(step.amount, step.currency)}
                          </s-text>
                        </>
                      )}
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>
            ) : null}
            {trace.checkoutRateIds?.length ? (
              <s-stack gap="small">
                <s-heading>Options at checkout</s-heading>
                <s-unordered-list>
                  {trace.checkoutRateIds.map((id) => {
                    const rate = trace.rates.find((item) => item.id === id);
                    return rate?.finalAmount != null ? (
                      <s-list-item key={id}>
                        {rate.name} · {money(rate.finalAmount, rate.currency)}
                      </s-list-item>
                    ) : null;
                  })}
                </s-unordered-list>
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
                      Price before settings rounding
                    </s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">
                      Final price
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {trace.rates.map((rate) => (
                      <s-table-row key={rate.id}>
                        <s-table-cell>
                          <s-stack gap="small">
                            <s-text>{rate.name}</s-text>
                            {rate.deliveryEstimate ? (
                              <s-text>{rate.deliveryEstimate}</s-text>
                            ) : null}
                            {rate.serviceCode ? (
                              <s-text color="subdued">
                                {rate.serviceCode}
                              </s-text>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{rate.scenario}</s-table-cell>
                        <s-table-cell>
                          {money(rate.amount, rate.currency)}
                        </s-table-cell>
                        <s-table-cell>
                          {rate.consumedBy
                            ? `Combined into ${rate.consumedBy}`
                            : rate.deduplicated
                              ? "Duplicate flat rate"
                              : rate.finalAmount === null
                                ? "Not selected"
                                : money(rate.finalAmount, rate.currency)}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {trace.rates
                  .filter(
                    (rate) =>
                      rate.steps?.length &&
                      (rate.steps.length > 1 || rate.steps[0].detail),
                  )
                  .map((rate) => (
                    <s-box
                      key={rate.id}
                      border="base base solid"
                      padding="base"
                      borderRadius="base"
                    >
                      <s-stack gap="small">
                        <s-heading>{rate.name}</s-heading>
                        {rate.tags?.length ? (
                          <s-text>Tags · {rate.tags.join(", ")}</s-text>
                        ) : null}
                        <s-unordered-list>
                          {rate.steps?.map((step, index) => (
                            <s-list-item key={index}>
                              {step.label} · {money(step.amount, rate.currency)}
                              {step.detail ? ` · ${step.detail}` : ""}
                            </s-list-item>
                          ))}
                        </s-unordered-list>
                      </s-stack>
                    </s-box>
                  ))}
              </s-stack>
            ) : null}
            {trace.rejectedRates?.length ? (
              <s-stack gap="small">
                <s-heading>Rates skipped</s-heading>
                <s-unordered-list>
                  {trace.rejectedRates.map((rate, index) => (
                    <s-list-item key={index}>
                      {rate.name} · {rate.scenario} ·{" "}
                      {rejectedLabels[rate.reason]}
                      {rate.detail ? ` · ${rate.detail}` : ""}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              </s-stack>
            ) : null}
          </>
        ) : null}
      </s-stack>
    </BorderedCard>
  );
}

export function CheckoutCartDetails({ snapshot }: { snapshot: CartSnapshot }) {
  return (
    <BorderedCard heading="Cart details">
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
    </BorderedCard>
  );
}
