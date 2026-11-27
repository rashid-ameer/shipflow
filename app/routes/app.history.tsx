import { BorderedCard } from "../components/bordered-card";
import {
  IndexTableFilterChips,
  IndexTableFilters,
  IndexTableSection,
} from "../components/index-table";
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { MarketsDashboard } from "../components/markets-dashboard";
import {
  findCustomers,
  getCustomerNames,
} from "../models/checkout-catalog.server";
import {
  diagnosticsPaths,
  formatPlace,
  historyCustomer,
  historyFilters,
  historyTime,
} from "../models/checkout-history";
import {
  listCarrierRequests,
  listHistoryDataRequests,
} from "../models/checkout-history.server";
import { getMarketsDashboardData } from "../models/market-readiness.server";
import { ratesPaths } from "../models/calculated-rates";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  const filters = historyFilters(new URL(request.url).searchParams);
  const marketsPromise = getMarketsDashboardData(
    admin.graphql,
    store.shopDomain,
    undefined,
    store.carrierServiceId,
  );
  const canSearchCustomer =
    filters.search.length >= 2 && !/^[0-9a-f-]{8,}$/i.test(filters.search);
  const matches = canSearchCustomer
    ? await findCustomers(admin.graphql, filters.search, true).catch(() => null)
    : [];
  const matchingCustomers =
    matches?.flatMap(({ id }) => id.split("/").at(-1) ?? []) ?? [];
  const [history, markets, dataRequests] = await Promise.all([
    listCarrierRequests(store.id, filters, matchingCustomers),
    marketsPromise,
    listHistoryDataRequests(store.id),
  ]);
  const names = await getCustomerNames(
    admin.graphql,
    history.rows.map(({ customerId }) => customerId),
  ).catch(() => null);
  const rows = history.rows.map(({ customerId, testIdentity, ...row }) => ({
    ...row,
    customer: historyCustomer(
      customerId ? names?.[customerId] : undefined,
      testIdentity,
      customerId,
    ),
  }));
  const { search, from, to, min, max } = filters;
  return {
    ...history,
    rows,
    markets,
    dataRequests,
    search,
    from,
    to,
    min,
    max,
    customerLookupUnavailable: matches === null || names === null,
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
  };
}

export default function CheckoutHistoryPage() {
  const history = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const refreshing = revalidator.state !== "idle";
  return (
    <s-page heading="Checkout history">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={refreshing}
        onClick={() => revalidator.revalidate()}
      >
        Refresh
      </s-button>
      <s-stack gap="base">
        <s-paragraph>
          View Carrier Service requests from the last 30 days. Dates and times
          use UTC.
        </s-paragraph>
        <MarketsDashboard
          data={history.markets}
          refreshing={refreshing}
          onRefresh={() => revalidator.revalidate()}
        />
        <HistoryList
          key={JSON.stringify([history.search, history.from, history.to])}
          history={history}
          loading={navigation.state !== "idle"}
        />
        {history.dataRequests.length ? (
          <HistoryDataRequests requests={history.dataRequests} />
        ) : null}
      </s-stack>
    </s-page>
  );
}

function HistoryDataRequests({
  requests,
}: {
  requests: Awaited<ReturnType<typeof loader>>["dataRequests"];
}) {
  const shopify = useAppBridge();
  const [downloading, setDownloading] = useState("");
  async function download(id: string) {
    setDownloading(id);
    try {
      const response = await fetch(diagnosticsPaths.exportCustomerData(id), {
        headers: { Authorization: `Bearer ${await shopify.idToken()}` },
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `shipflow-customer-data-${id}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      shopify.toast.show(
        "The customer data could not be downloaded. Refresh and try again.",
        { isError: true },
      );
    } finally {
      setDownloading("");
    }
  }
  return (
    <BorderedCard heading="Customer data requests">
      <s-stack gap="small">
        <s-paragraph>
          Download the checkout data Shopify requested for each customer.
        </s-paragraph>
        {requests.map(({ requestId, receivedAt }) => (
          <s-stack
            key={requestId}
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text>
              Request {requestId} · {historyTime(receivedAt)}
            </s-text>
            <s-button
              disabled={Boolean(downloading)}
              loading={downloading === requestId}
              onClick={() => void download(requestId)}
            >
              Download data
            </s-button>
          </s-stack>
        ))}
      </s-stack>
    </BorderedCard>
  );
}

function HistoryList({
  history,
  loading,
}: {
  history: Awaited<ReturnType<typeof loader>>;
  loading: boolean;
}) {
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState(history.search);
  const [draftRange, setDraftRange] = useState<string>();
  const [from, to = ""] =
    draftRange === undefined
      ? [history.from, history.to]
      : draftRange.split("--");
  const selectingEnd = draftRange !== undefined && Boolean(from && !to);
  const invalidDates = Boolean(from && to && from > to);
  const rangeStart = from || history.min;
  const rangeEnd = to || history.max;
  const rangeLabel = selectingEnd
    ? `${from} – Select end date`
    : from || to
      ? rangeStart === rangeEnd
        ? rangeStart
        : `${rangeStart} – ${rangeEnd}`
      : "";
  function go(page: number, includeDraftFilters = false) {
    const next = new URLSearchParams();
    const [search, start, end] = includeDraftFilters
      ? [query.trim(), from, to]
      : [history.search, history.from, history.to];
    if (search) next.set("q", search);
    if (start) next.set("from", start);
    if (end) next.set("to", end);
    if (page > 1) next.set("page", String(page));
    setParams(next);
  }
  return (
    <>
      {history.customerLookupUnavailable ? (
        <s-banner tone="info" heading="Customer names are unavailable">
          <s-paragraph>
            You can still search by History ID. Shopify customer access is
            needed to look up names.
          </s-paragraph>
          <s-button
            slot="secondary-actions"
            onClick={async () => {
              try {
                const access = await shopify.scopes.request(["read_customers"]);
                if (access.detail.granted.includes("read_customers"))
                  revalidator.revalidate();
              } catch {
                shopify.toast.show(
                  "Customer access could not be requested. Try again.",
                  { isError: true },
                );
              }
            }}
          >
            Allow customer access
          </s-button>
        </s-banner>
      ) : null}
      <IndexTableSection
        label="Checkout requests"
        loading={loading}
        paginate={history.pageCount > 1}
        hasPreviousPage={history.page > 1}
        hasNextPage={history.page < history.pageCount}
        onPreviousPage={() => go(history.page - 1)}
        onNextPage={() => go(history.page + 1)}
      >
        <IndexTableFilters columns="minmax(0, 2fr) auto">
          <s-search-field
            label="Search customer name or History ID"
            value={query}
            maxLength={120}
            disabled={loading}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <s-stack direction="inline">
            <s-button
              icon="calendar"
              accessibilityLabel={
                rangeLabel ? `Date range, ${rangeLabel}` : undefined
              }
              commandFor="history-date-range"
              command="--toggle"
              disabled={loading}
            >
              {rangeLabel || "Date range"}
            </s-button>
            <s-popover id="history-date-range" inlineSize="300px">
              <s-box padding="small">
                <s-stack gap="small">
                  <s-date-picker
                    type="range"
                    allow={`${history.min}--${history.max}`}
                    defaultView={(history.from || history.to || history.max).slice(
                      0,
                      7,
                    )}
                    value={
                      draftRange ??
                      (from || to ? `${rangeStart}--${rangeEnd}` : "")
                    }
                    onInput={(event) => setDraftRange(event.currentTarget.value)}
                  />
                  <s-stack direction="inline" justifyContent="end">
                    <s-button commandFor="history-date-range" command="--hide">
                      Done
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            </s-popover>
          </s-stack>
        </IndexTableFilters>
        <s-stack slot="filters" direction="inline" gap="small" justifyContent="end">
          {invalidDates ? (
            <s-text tone="critical">
              Choose an end date on or after the start date.
            </s-text>
          ) : null}
          {history.search || history.from || history.to ? (
            <s-button
              disabled={loading}
              onClick={() => {
                setQuery("");
                setDraftRange(undefined);
                setParams(new URLSearchParams());
              }}
            >
              Clear filters
            </s-button>
          ) : null}
          <s-button
            disabled={loading || selectingEnd || invalidDates}
            onClick={() => go(1, true)}
          >
            Apply filters
          </s-button>
        </s-stack>
        <IndexTableFilterChips
          filters={[
            ...(history.search
              ? [
                  {
                    label: `Search: ${history.search}`,
                    onRemove: () => {
                      const params = new URLSearchParams();
                      if (history.from) params.set("from", history.from);
                      if (history.to) params.set("to", history.to);
                      setQuery("");
                      setParams(params);
                    },
                  },
                ]
              : []),
            ...(history.from || history.to
              ? [
                  {
                    label: `Date: ${history.from || history.min} – ${history.to || history.max}`,
                    onRemove: () => {
                      const params = new URLSearchParams();
                      if (history.search) params.set("q", history.search);
                      setDraftRange(undefined);
                      setParams(params);
                    },
                  },
                ]
              : []),
          ]}
          onClearAll={() => {
            setQuery("");
            setDraftRange(undefined);
            setParams(new URLSearchParams());
          }}
        />
        <s-table-header-row>
          <s-table-header listSlot="primary">History ID</s-table-header>
          <s-table-header listSlot="labeled">Customer</s-table-header>
          <s-table-header listSlot="labeled">Received</s-table-header>
          <s-table-header listSlot="labeled">Destination</s-table-header>
          <s-table-header listSlot="labeled">Outcome</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {history.rows.map((row) => (
            <s-table-row key={row.id} clickDelegate={`history-${row.id}`}>
              <s-table-cell>
                <s-link id={`history-${row.id}`} href={diagnosticsPaths.request(row.id)}>
                  {row.id}
                </s-link>
              </s-table-cell>
              <s-table-cell>{row.customer}</s-table-cell>
              <s-table-cell>{historyTime(row.receivedAt)}</s-table-cell>
              <s-table-cell>{formatPlace(row)}</s-table-cell>
              <s-table-cell>
                <s-badge
                  tone={
                    row.statusCode >= 400
                      ? "critical"
                      : row.rateCount
                        ? "success"
                        : "neutral"
                  }
                >
                  {row.statusCode >= 400
                    ? "Request error"
                    : row.rateCount
                      ? `${row.rateCount} ${row.rateCount === 1 ? "rate" : "rates"}`
                      : "No rates"}
                </s-badge>
              </s-table-cell>
            </s-table-row>
          ))}
          {history.hasRequests ? (
            <s-empty-state heading="No requests match those filters">
              <s-icon slot="graphic" type="search" />
              <s-text slot="subheading">
                Try a different date range or search term.
              </s-text>
              <s-button
                slot="primary-action"
                variant="primary"
                onClick={() => {
                  setQuery("");
                  setDraftRange(undefined);
                  setParams(new URLSearchParams());
                }}
              >
                Clear filters
              </s-button>
            </s-empty-state>
          ) : (
            <s-empty-state heading="No checkout requests received">
              <s-text slot="subheading">
                {history.connected
                  ? "Shopify hasn’t sent ShipFlow a Carrier Service request in the last 30 days. Verify the shipping setup and use a real checkout in a destination where ShipFlow is enabled."
                  : "Connect Carrier Calculated Shipping and enable ShipFlow as a rate provider in Shopify."}
              </s-text>
              <s-button
                slot="primary-action"
                variant="primary"
                href={ratesPaths.hub}
              >
                Check calculated shipping setup
              </s-button>
            </s-empty-state>
          )}
        </s-table-body>
      </IndexTableSection>
      {history.pageCount > 1 ? (
        <s-text color="subdued">
          {history.page} of {history.pageCount}
        </s-text>
      ) : null}
    </>
  );
}
