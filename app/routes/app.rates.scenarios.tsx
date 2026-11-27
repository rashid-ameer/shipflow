import { BorderedCard } from "../components/bordered-card";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { rateIdPattern, ratesPaths } from "../models/calculated-rates";
import {
  changeScenarios,
  listScenarios,
  rateFormFailure,
  RateFormError,
} from "../models/calculated-rates.server";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await requireRatesStore(request);
  const params = new URL(request.url).searchParams;
  const search = (params.get("q") ?? "").trim().slice(0, 120);
  const filter = params.get("status");
  const status = filter === "active" || filter === "inactive" ? filter : "all";
  const page = Number(params.get("page"));
  const result = await listScenarios(
    store.id,
    search,
    status,
    Number.isSafeInteger(page) && page > 0 ? page : 1,
  );
  return {
    ...result,
    search,
    status,
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { store } = await requireRatesStore(request, true);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    const ids = form.getAll("id");
    if (
      ids.length === 0 ||
      ids.length > 25 ||
      new Set(ids).size !== ids.length ||
      !ids.every(
        (id): id is string => typeof id === "string" && rateIdPattern.test(id),
      ) ||
      (intent !== "activate" && intent !== "deactivate" && intent !== "delete")
    ) {
      throw new RateFormError("Select valid scenarios and an action.");
    }
    await changeScenarios(store.shopDomain, ids, intent);
    return { ok: true as const, intent };
  } catch (error) {
    return rateFormFailure(error);
  }
}

export default function ScenariosPage() {
  const { rows, search, status, total, page, pageCount, connected } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState(search);
  const [selected, setSelected] = useState<string[]>([]);
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const busy = fetcher.state !== "idle";
  const selection = selected.filter((id) => rows.some((row) => row.id === id));
  const allSelected = rows.length > 0 && rows.length === selection.length;

  function lookup(q: string, value: string, targetPage = 1) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (value !== "all") params.set("status", value);
    if (targetPage > 1) params.set("page", String(targetPage));
    return params;
  }
  useEffect(() => {
    if (query.trim() === search) return;
    const timeout = window.setTimeout(() => {
      setSelected([]);
      setParams(lookup(query, status), { replace: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query, search, status, setParams]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result || busy || handled.current === result) return;
    handled.current = result;
    if (result.ok) {
      setSelected([]);
      if (result.intent === "delete") modal.current?.hideOverlay();
      shopify.toast.show(
        result.intent === "delete"
          ? "Scenarios deleted"
          : "Scenario status updated",
      );
    }
  }, [fetcher.data, busy, shopify]);

  function submit(intent: "activate" | "deactivate" | "delete") {
    const form = new FormData();
    form.set("intent", intent);
    selection.forEach((id) => form.append("id", id));
    fetcher.submit(form, { method: "post" });
  }

  return (
    <s-page heading="Scenarios">
      <s-link slot="breadcrumb-actions" href={ratesPaths.hub}>
        Rates
      </s-link>
      <s-stack gap="base">
        {fetcher.data && !fetcher.data.ok ? (
          <s-banner tone="critical" heading="Scenarios were not updated">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        ) : null}
        {!connected ? (
          <s-banner tone="info" heading="Drafts are available">
            <s-paragraph>
              Connect calculated shipping on the Rates page before activating
              scenarios.
            </s-paragraph>
          </s-banner>
        ) : null}
        <BorderedCard
          heading={
            total === 0 ? "Create your first scenario" : "Saved scenarios"
          }
        >
          <s-stack gap="base">
            {total === 0 ? (
              <s-paragraph>
                Add a shipping rate and the conditions under which it should
                appear.
              </s-paragraph>
            ) : (
              <>
                <s-grid
                  gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr)"
                  gap="base"
                >
                  <s-search-field
                    label="Search scenarios"
                    value={query}
                    maxLength={120}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                  />
                  <s-select
                    label="Status"
                    value={status}
                    onChange={(event) => {
                      setSelected([]);
                      setParams(lookup(query, event.currentTarget.value));
                    }}
                  >
                    <s-option value="all">All</s-option>
                    <s-option value="active">Active</s-option>
                    <s-option value="inactive">Inactive</s-option>
                  </s-select>
                </s-grid>
                {rows.length === 0 ? (
                  <s-stack gap="small">
                    <s-paragraph>No scenarios match your filters.</s-paragraph>
                    <s-stack direction="inline">
                      <s-button
                        variant="secondary"
                        onClick={() => {
                          setQuery("");
                          setParams({});
                        }}
                      >
                        Clear filters
                      </s-button>
                    </s-stack>
                  </s-stack>
                ) : (
                  <>
                    {selection.length > 0 ? (
                      <s-stack
                        direction="inline"
                        gap="small"
                        alignItems="center"
                      >
                        <s-text>{selection.length} selected</s-text>
                        <s-button
                          variant="secondary"
                          disabled={busy || !connected}
                          onClick={() => submit("activate")}
                        >
                          Set active
                        </s-button>
                        <s-button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => submit("deactivate")}
                        >
                          Set inactive
                        </s-button>
                        <s-button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => modal.current?.showOverlay()}
                        >
                          Delete selected
                        </s-button>
                      </s-stack>
                    ) : null}
                    <s-table>
                      <s-table-header-row>
                        <s-table-header>
                          <s-checkbox
                            accessibilityLabel="Select all scenarios"
                            checked={allSelected}
                            onChange={(event) =>
                              setSelected(
                                event.currentTarget.checked
                                  ? rows.map(({ id }) => id)
                                  : [],
                              )
                            }
                          />
                        </s-table-header>
                        <s-table-header listSlot="primary">Name</s-table-header>
                        <s-table-header listSlot="inline">
                          Status
                        </s-table-header>
                        <s-table-header listSlot="labeled">
                          Rates
                        </s-table-header>
                        <s-table-header listSlot="labeled">
                          Updated
                        </s-table-header>
                      </s-table-header-row>
                      <s-table-body>
                        {rows.map((row) => (
                          <s-table-row key={row.id}>
                            <s-table-cell>
                              <s-checkbox
                                accessibilityLabel={`Select ${row.name}`}
                                checked={selection.includes(row.id)}
                                disabled={busy}
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  setSelected((current) =>
                                    checked
                                      ? [...new Set([...current, row.id])]
                                      : current.filter((id) => id !== row.id),
                                  );
                                }}
                              />
                            </s-table-cell>
                            <s-table-cell>
                              <s-link href={ratesPaths.scenario(row.id)}>
                                {row.name}
                              </s-link>
                            </s-table-cell>
                            <s-table-cell>
                              <s-badge
                                tone={row.active ? "success" : "neutral"}
                              >
                                {row.active ? "Active" : "Inactive"}
                              </s-badge>
                            </s-table-cell>
                            <s-table-cell>{row._count.rates}</s-table-cell>
                            <s-table-cell>
                              {new Date(row.updatedAt)
                                .toISOString()
                                .slice(0, 10)}
                            </s-table-cell>
                          </s-table-row>
                        ))}
                      </s-table-body>
                    </s-table>
                    {pageCount > 1 ? (
                      <s-stack
                        direction="inline"
                        justifyContent="end"
                        alignItems="center"
                        gap="small"
                      >
                        <s-button
                          variant="secondary"
                          disabled={page === 1}
                          onClick={() => {
                            setSelected([]);
                            setParams(lookup(search, status, page - 1));
                          }}
                        >
                          Previous
                        </s-button>
                        <s-text>
                          {page} of {pageCount}
                        </s-text>
                        <s-button
                          variant="secondary"
                          disabled={page >= pageCount}
                          onClick={() => {
                            setSelected([]);
                            setParams(lookup(search, status, page + 1));
                          }}
                        >
                          Next
                        </s-button>
                      </s-stack>
                    ) : null}
                  </>
                )}
              </>
            )}
            <s-stack direction="inline" justifyContent="end" gap="small">
              <s-button variant="secondary" href={ratesPaths.regions}>
                Manage regions
              </s-button>
              <s-button variant="primary" href={ratesPaths.scenario("new")}>
                Create scenario
              </s-button>
            </s-stack>
          </s-stack>
        </BorderedCard>
      </s-stack>
      <s-modal
        id="delete-scenarios-modal"
        ref={modal as never}
        heading={`Delete ${selection.length} ${selection.length === 1 ? "scenario" : "scenarios"}?`}
      >
        {fetcher.data && !fetcher.data.ok ? (
          <s-banner tone="critical" heading={fetcher.data.error} />
        ) : null}
        <s-paragraph>
          The selected scenarios and their conditions and rates will be
          permanently deleted.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          disabled={busy}
          commandFor="delete-scenarios-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          disabled={busy || selection.length === 0}
          onClick={() => submit("delete")}
        >
          Delete scenarios
        </s-button>
      </s-modal>
    </s-page>
  );
}
