import { BorderedCard } from "../components/bordered-card";
import { useAppBridge } from "@shopify/app-bridge-react";
import { data, useLoaderData, type LoaderFunctionArgs } from "react-router";
import {
  CheckoutCartDetails,
  CheckoutPricingResults,
} from "../components/checkout-pricing-results";
import { rateIdPattern, type PricingTrace } from "../models/calculated-rates";
import { getCustomerNames } from "../models/checkout-catalog.server";
import {
  diagnosticsPaths,
  formatPlace,
  historyCustomer,
  historyTime,
  type CartSnapshot,
} from "../models/checkout-history";
import { getCarrierRequest } from "../models/checkout-history.server";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  const row =
    params.id && rateIdPattern.test(params.id)
      ? await getCarrierRequest(store.id, params.id)
      : null;
  if (!row) return data({ found: false as const }, { status: 404 });
  const { customerId, snapshot, trace, testIdentity, ...details } = row;
  const names = customerId
    ? await getCustomerNames(admin.graphql, [customerId]).catch(
        () => ({}) as Record<string, string>,
      )
    : {};
  return {
    found: true as const,
    ...details,
    customer: historyCustomer(
      customerId ? names[customerId] : undefined,
      testIdentity,
      customerId,
    ),
    identity: testIdentity,
    snapshot: snapshot as CartSnapshot | null,
    trace: trace as PricingTrace | null,
  };
}

export default function CheckoutHistoryRequestPage() {
  const entry = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  return (
    <s-page heading="Checkout request">
      <s-link slot="breadcrumb-actions" href={diagnosticsPaths.history}>
        History
      </s-link>
      {entry.found ? (
        <>
          <s-button
            slot="secondary-actions"
            href={diagnosticsPaths.simulator}
          >
            Open simulator
          </s-button>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(entry.id);
                shopify.toast.show("History ID copied");
              } catch {
                shopify.toast.show(
                  "Copy the History ID from the request details.",
                  { isError: true },
                );
              }
            }}
          >
            Copy History ID
          </s-button>
        </>
      ) : null}
      {!entry.found ? (
        <s-banner tone="info" heading="Request unavailable">
          <s-paragraph>
            Check the History ID and date. History shows requests from this
            store in the last 30 days.
          </s-paragraph>
          <s-button slot="secondary-actions" href={diagnosticsPaths.history}>
            Back to history
          </s-button>
        </s-banner>
      ) : (
        <s-stack gap="base">
          <BorderedCard heading="Request details">
            <s-stack gap="small">
              <s-text>History ID: {entry.id}</s-text>
              <s-text>Received: {historyTime(entry.receivedAt)}</s-text>
              <s-text>Customer: {entry.customer}</s-text>
              <s-text>
                Test identity:{" "}
                {entry.identity === "test"
                  ? "Matched"
                  : entry.identity === "other"
                    ? "Ordinary checkout"
                    : "Unavailable"}
              </s-text>
              <s-text>HTTP response: {entry.statusCode}</s-text>
              {!entry.snapshot ? (
                <s-text>Destination: {formatPlace(entry)}</s-text>
              ) : null}
            </s-stack>
          </BorderedCard>
          {entry.snapshot ? (
            <CheckoutCartDetails snapshot={entry.snapshot} />
          ) : (
            <s-banner tone="info">
              <s-paragraph>
                Cart details are unavailable for this request.
              </s-paragraph>
            </s-banner>
          )}
          <CheckoutPricingResults
            reason={entry.reason}
            trace={entry.trace}
            rateCount={entry.rateCount}
          />
        </s-stack>
      )}
    </s-page>
  );
}
