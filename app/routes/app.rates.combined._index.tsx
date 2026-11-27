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
import { combinedPaths, combinationMethods } from "../models/combined-rates";
import {
  changeCombinedRules,
  combinedPageSize,
  listCombinedRules,
  moveCombinedRule,
} from "../models/combined-rates.server";
import {
  rateFormFailure,
  RateFormError,
} from "../models/calculated-rates.server";
import { rateIdPattern, ratesPaths } from "../models/calculated-rates";
import { diagnosticsPaths } from "../models/checkout-history";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await requireRatesStore(request);
  const params = new URL(request.url).searchParams;
  const search = (params.get("q") ?? "").trim().slice(0, 120);
  const filter = params.get("status");
  const status = filter === "active" || filter === "inactive" ? filter : "all";
  const sort = params.get("sort") === "name" ? "name" : "priority";
  const page = Number(params.get("page"));
  const result = await listCombinedRules(store.id, {
    search,
    status,
    sort,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  });
  return {
    ...result,
    search,
    status,
    sort,
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { store } = await requireRatesStore(request, true);
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = form.getAll("id");
  try {
    if (
      !ids.length ||
      ids.length > combinedPageSize ||
      new Set(ids).size !== ids.length ||
      !ids.every(
        (id): id is string => typeof id === "string" && rateIdPattern.test(id),
      )
    )
      throw new RateFormError("Select valid combined rates.");
    if (intent === "up" || intent === "down") {
      const position = Number(form.get("position"));
      if (ids.length !== 1 || !Number.isSafeInteger(position) || position < 1)
        throw new RateFormError("Refresh the list before moving the rule.");
      await moveCombinedRule(store.shopDomain, ids[0], position, intent);
    } else if (
      intent === "activate" ||
      intent === "deactivate" ||
      intent === "delete"
    ) {
      await changeCombinedRules(store.shopDomain, ids, intent);
    } else throw new RateFormError("Choose a valid action.");
    return { ok: true as const, intent };
  } catch (error) {
    return rateFormFailure(error);
  }
}

export default function CombinedRatesPage() {
  const { rows, search, status, sort, total, page, pageCount, connected } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [, setParams] = useSearchParams();
  const [query, setQuery] = useState(search);
  const [checked, setChecked] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState<string>();
  const deleteModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const busy = fetcher.state !== "idle";
  const selected = checked.filter((id) => rows.some((row) => row.id === id));
  const manualOrder = sort === "priority" && !search && status === "all";
  function filter(q: string, filterStatus: string, order: string, target = 1) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (order !== "priority") params.set("sort", order);
    if (target > 1) params.set("page", String(target));
    return params;
  }
  useEffect(() => {
    if (query.trim() === search) return;
    const debounce = window.setTimeout(() => {
      setChecked([]);
      setParams(filter(query, status, sort), { replace: true });
    }, 250);
    return () => window.clearTimeout(debounce);
  }, [query, search, status, sort, setParams]);
  useEffect(() => {
    const result = fetcher.data;
    if (busy || !result || handled.current === result) return;
    handled.current = result;
    if (result.ok) {
      setChecked([]);
      if (result.intent === "delete") deleteModal.current?.hideOverlay();
      shopify.toast.show(
        result.intent === "delete"
          ? "Combined rates deleted"
          : result.intent === "up" || result.intent === "down"
            ? "Rule order updated"
            : "Combined rate status updated",
      );
    } else if (confirmation.length) {
      setDeleteError(result.error);
    }
  }, [busy, fetcher.data, shopify, confirmation.length]);
  function submit(intent: string, ids: string[], position?: number) {
    const form = new FormData();
    form.set("intent", intent);
    for (const id of ids) form.append("id", id);
    if (position !== undefined) form.set("position", String(position));
    fetcher.submit(form, { method: "post" });
  }

  return (
    <s-page heading="Combined shipping rates">
      <s-link slot="breadcrumb-actions" href={ratesPaths.hub}>
        Rates
      </s-link>
      <s-stack gap="base">
        {fetcher.data && !fetcher.data.ok && !deleteError ? (
          <s-banner
            tone="critical"
            heading="Combined rates could not be updated"
          >
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        ) : null}
        {total ? (
          <BorderedCard heading="Rules">
            <s-stack gap="base">
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 155px), 1fr))"
                gap="base"
              >
                <s-search-field
                  label="Search combined rates"
                  value={query}
                  maxLength={120}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
                <s-select
                  label="Status"
                  value={status}
                  onChange={(event) => {
                    setChecked([]);
                    setParams(filter(query, event.currentTarget.value, sort));
                  }}
                >
                  <s-option value="all">All statuses</s-option>
                  <s-option value="active">Active</s-option>
                  <s-option value="inactive">Inactive</s-option>
                </s-select>
                <s-select
                  label="Sort by"
                  value={sort}
                  onChange={(event) => {
                    setChecked([]);
                    setParams(filter(query, status, event.currentTarget.value));
                  }}
                >
                  <s-option value="priority">Rule order</s-option>
                  <s-option value="name">Name</s-option>
                </s-select>
              </s-grid>
              {manualOrder && total > 1 ? (
                <s-paragraph>Rules run from top to bottom.</s-paragraph>
              ) : null}
              {selected.length ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text>{selected.length} selected</s-text>
                  <s-button
                    disabled={busy || !connected}
                    onClick={() => submit("activate", selected)}
                  >
                    Set active
                  </s-button>
                  <s-button
                    disabled={busy}
                    onClick={() => submit("deactivate", selected)}
                  >
                    Set inactive
                  </s-button>
                  <s-button
                    disabled={busy}
                    commandFor="delete-combined-rates"
                    command="--show"
                    onClick={() => {
                      setDeleteError(undefined);
                      setConfirmation(selected);
                    }}
                  >
                    Delete selected
                  </s-button>
                </s-stack>
              ) : null}
              {rows.length ? (
                <s-table
                  paginate
                  hasPreviousPage={page > 1}
                  hasNextPage={page < pageCount}
                  loading={busy}
                  onPreviousPage={() => {
                    setChecked([]);
                    setParams(filter(search, status, sort, page - 1));
                  }}
                  onNextPage={() => {
                    setChecked([]);
                    setParams(filter(search, status, sort, page + 1));
                  }}
                >
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        accessibilityLabel="Select all combined rates"
                        checked={selected.length === rows.length}
                        onChange={(event) =>
                          setChecked(
                            event.currentTarget.checked
                              ? rows.map(({ id }) => id)
                              : [],
                          )
                        }
                      />
                    </s-table-header>
                    <s-table-header listSlot="primary">Rule</s-table-header>
                    <s-table-header listSlot="labeled">
                      Calculation
                    </s-table-header>
                    <s-table-header listSlot="labeled">
                      Tags and criteria
                    </s-table-header>
                    <s-table-header listSlot="labeled">Status</s-table-header>
                    {manualOrder ? (
                      <s-table-header>Order</s-table-header>
                    ) : null}
                  </s-table-header-row>
                  <s-table-body>
                    {rows.map((row, index) => (
                      <s-table-row key={row.id}>
                        <s-table-cell>
                          <s-checkbox
                            accessibilityLabel={`Select ${row.name}`}
                            checked={selected.includes(row.id)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setChecked((current) =>
                                checked
                                  ? [...new Set([...current, row.id])]
                                  : current.filter((id) => id !== row.id),
                              );
                            }}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <s-link href={combinedPaths.editor(row.id)}>
                            {row.name}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>
                          {combinationMethods[row.method]}
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack gap="small">
                            <s-text>{row.tags.join(", ")}</s-text>
                            <s-text>
                              {row.requirement === "all"
                                ? "All tags"
                                : "Any tag"}
                              {row.requireTwoTags ? " · At least two tags" : ""}
                            </s-text>
                            {row.outputTag ? (
                              <s-text>Output tag · {row.outputTag}</s-text>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={row.active ? "success" : "neutral"}>
                            {row.active ? "Active" : "Inactive"}
                          </s-badge>
                        </s-table-cell>
                        {manualOrder ? (
                          <s-table-cell>
                            <s-stack direction="inline" gap="small">
                              <s-button
                                variant="tertiary"
                                accessibilityLabel={`Move ${row.name} up`}
                                icon="arrow-up"
                                disabled={busy || (page === 1 && index === 0)}
                                onClick={() =>
                                  submit("up", [row.id], row.position)
                                }
                              />
                              <s-button
                                variant="tertiary"
                                accessibilityLabel={`Move ${row.name} down`}
                                icon="arrow-down"
                                disabled={
                                  busy ||
                                  (page === pageCount &&
                                    index === rows.length - 1)
                                }
                                onClick={() =>
                                  submit("down", [row.id], row.position)
                                }
                              />
                            </s-stack>
                          </s-table-cell>
                        ) : null}
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : (
                <s-paragraph>No combined rates match your filters.</s-paragraph>
              )}
            </s-stack>
          </BorderedCard>
        ) : (
          <BorderedCard heading="No combined rates yet">
            <s-paragraph>
              Combine tagged shipping rates into one checkout option.
            </s-paragraph>
          </BorderedCard>
        )}
        <s-stack direction="inline" gap="small" justifyContent="end">
          <s-button href={diagnosticsPaths.simulator}>Open simulator</s-button>
          <s-button variant="primary" href={combinedPaths.editor("new")}>
            Add combined rate
          </s-button>
        </s-stack>
      </s-stack>
      <s-modal
        id="delete-combined-rates"
        ref={deleteModal}
        heading="Delete selected combined rates?"
        onHide={() => {
          setConfirmation([]);
          setDeleteError(undefined);
        }}
      >
        <s-stack gap="base">
          {deleteError ? (
            <s-banner tone="critical" heading="Could not delete combined rates">
              <s-paragraph>{deleteError}</s-paragraph>
            </s-banner>
          ) : null}
          <s-paragraph>
            Deleting these rules removes their combinations from checkout.
          </s-paragraph>
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="delete-combined-rates"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          tone="critical"
          variant="primary"
          loading={busy}
          disabled={busy || !confirmation.length}
          onClick={() => {
            setDeleteError(undefined);
            submit("delete", confirmation);
          }}
        >
          Delete
        </s-button>
      </s-modal>
    </s-page>
  );
}
