import { BorderedCard } from "../components/bordered-card";
import {
  IndexTableFilterChips,
  IndexTableFilters,
  IndexTableRowActions,
  IndexTableSection,
} from "../components/index-table";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import {
  findCustomers,
  getCustomerNames,
} from "../models/checkout-catalog.server";
import {
  diagnosticsPaths,
  formatPlace,
  historyCustomer,
  historyFilterParams,
  historyFilters,
  historyTime,
  parseHistoryRange,
} from "../models/checkout-history";
import {
  listCarrierRequests,
  listHistoryDataRequests,
} from "../models/checkout-history.server";
import { ratesPaths } from "../models/calculated-rates";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  const filters = historyFilters(new URL(request.url).searchParams);
  const canSearchCustomer =
    filters.search.length >= 2 && !/^[0-9a-f-]{8,}$/i.test(filters.search);
  const matches = canSearchCustomer
    ? await findCustomers(admin.graphql, filters.search, true).catch(() => null)
    : [];
  const matchingCustomers =
    matches?.flatMap(({ id }) => id.split("/").at(-1) ?? []) ?? [];
  const [history, dataRequests] = await Promise.all([
    listCarrierRequests(store.id, filters, matchingCustomers),
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
      {history.hasRequests ? null : (
        <s-button slot="secondary-actions" href={ratesPaths.hub}>
          Check calculated shipping setup
        </s-button>
      )}
      <s-stack gap="base">
        <s-paragraph>
          View Carrier Service requests from the last 30 days. Dates and times
          use UTC.
        </s-paragraph>
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
  const dateRangePopover = useRef<HTMLElementTagNameMap["s-popover"] | null>(
    null,
  );
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
  useEffect(() => setQuery(history.search), [history.search]);
  useEffect(() => setDraftRange(undefined), [history.from, history.to]);
  useEffect(() => {
    if (query.trim() === history.search) return;
    const timeout = window.setTimeout(() => {
      setParams(
        historyFilterParams({
          search: query,
          from: history.from,
          to: history.to,
        }),
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, history.search, history.from, history.to, setParams]);
  function applyRange(value: string) {
    setDraftRange(value);
    const { from: start, to: end } = parseHistoryRange(value);
    if (!start || !end || start > end) return;
    setParams(
      historyFilterParams({ search: query, from: start, to: end }),
    );
    (
      dateRangePopover.current as unknown as { hideOverlay?: () => void } | null
    )?.hideOverlay?.();
  }
  function go(page: number) {
    setParams(
      historyFilterParams({
        search: history.search,
        from: history.from,
        to: history.to,
        page,
      }),
    );
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
        filters={
          <>
            <IndexTableFilters columns="minmax(0, 2fr) auto">
              <s-search-field
                label="Search customer name or History ID"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search customer name or History ID"
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
                <s-popover
                  ref={dateRangePopover}
                  id="history-date-range"
                  inlineSize="300px"
                >
                  <s-box padding="small">
                    <s-date-picker
                      type="range"
                      allow={`${history.min}--${history.max}`}
                      defaultView={(
                        history.from ||
                        history.to ||
                        history.max
                      ).slice(0, 7)}
                      value={
                        draftRange ??
                        (from || to ? `${rangeStart}--${rangeEnd}` : "")
                      }
                      onInput={(event) =>
                        applyRange(event.currentTarget.value)
                      }
                    />
                  </s-box>
                </s-popover>
              </s-stack>
            </IndexTableFilters>
            {invalidDates ? (
              <s-text tone="critical">
                Choose an end date on or after the start date.
              </s-text>
            ) : null}
            <IndexTableFilterChips
              filters={[
                ...(history.search
                  ? [
                      {
                        label: `Search: ${history.search}`,
                        onRemove: () => {
                          setQuery("");
                          setParams(
                            historyFilterParams({
                              from: history.from,
                              to: history.to,
                            }),
                          );
                        },
                      },
                    ]
                  : []),
                ...(history.from || history.to
                  ? [
                      {
                        label: `Date: ${history.from || history.min} – ${history.to || history.max}`,
                        onRemove: () => {
                          setDraftRange(undefined);
                          setParams(
                            historyFilterParams({ search: history.search }),
                          );
                        },
                      },
                    ]
                  : []),
              ]}
              onClearAll={() => {
                setQuery("");
                setDraftRange(undefined);
                setParams(historyFilterParams());
              }}
            />
          </>
        }
      >
        <s-table-header-row>
          <s-table-header listSlot="primary">History ID</s-table-header>
          <s-table-header listSlot="labeled">Customer</s-table-header>
          <s-table-header listSlot="labeled">Received</s-table-header>
          <s-table-header listSlot="labeled">Destination</s-table-header>
          <s-table-header listSlot="labeled">Outcome</s-table-header>
          <s-table-header>Actions</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {history.rows.map((row) => (
            <s-table-row key={row.id} clickDelegate={`history-${row.id}`}>
              <s-table-cell>
                <s-button
                  id={`history-${row.id}`}
                  variant="tertiary"
                  href={diagnosticsPaths.request(row.id)}
                >
                  {row.id}
                </s-button>
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
              <s-table-cell>
                <IndexTableRowActions id={row.id} label={`request ${row.id}`}>
                  <s-button
                    icon="view"
                    href={diagnosticsPaths.request(row.id)}
                  >
                    View request
                  </s-button>
                  <s-button
                    icon="clipboard"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(row.id);
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
                </IndexTableRowActions>
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
                  setParams(historyFilterParams());
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
