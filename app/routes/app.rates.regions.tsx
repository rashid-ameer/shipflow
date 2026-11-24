import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  countries,
  rateIdPattern,
  ratesPaths,
  type Coverage,
} from "../models/calculated-rates";
import {
  deleteRegion,
  listRegions,
  loadRatesContext,
  rateFormFailure,
  RateFormError,
  saveRegion,
} from "../models/calculated-rates.server";
import { requireRatesStore } from "../models/rates-access.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  await loadRatesContext(admin.graphql, store);
  return { regions: await listRegions(store.id) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { store } = await requireRatesStore(request, true);
  const form = await request.formData();
  try {
    const intent = form.get("intent");
    const id = form.get("id");
    if (
      intent === "delete" &&
      typeof id === "string" &&
      rateIdPattern.test(id)
    ) {
      const count = Number(form.get("expectedCount"));
      if (!Number.isSafeInteger(count) || count < 0)
        throw new RateFormError("Refresh the region before deleting it.");
      await deleteRegion(store.shopDomain, id, count);
    } else if (
      intent === "save" &&
      (id === "" || (typeof id === "string" && rateIdPattern.test(id)))
    ) {
      const json = form.get("coverage");
      if (typeof json !== "string" || json.length > 30_000)
        throw new RateFormError("Check the countries and provinces.");
      await saveRegion(
        store.shopDomain,
        id || null,
        form.get("name"),
        JSON.parse(json),
      );
    } else {
      throw new RateFormError("Choose a valid region action.");
    }
    return { ok: true as const, intent };
  } catch (error) {
    return rateFormFailure(error);
  }
}

type Regions = Awaited<ReturnType<typeof loader>>["regions"];
type RegionEditor = {
  id: string;
  name: string;
  coverage: { country: string; provinces: string }[];
};

export default function RegionsPage() {
  const { regions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [draft, edit] = useState<RegionEditor | null>(null);
  const [target, confirm] = useState<Regions[number] | null>(null);
  const [error, setError] = useState<string>();
  const editor = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const del = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const busy = fetcher.state !== "idle";
  const canDelete = regions.filter((row) => row.kind !== "REST").length > 1;

  const editing = draft !== null;
  const deleting = target !== null;
  useEffect(() => {
    if (editing) editor.current?.showOverlay();
  }, [editing]);
  useEffect(() => {
    if (deleting) del.current?.showOverlay();
  }, [deleting]);
  useEffect(() => {
    const result = fetcher.data;
    if (busy || !result || handled.current === result) return;
    handled.current = result;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    editor.current?.hideOverlay();
    del.current?.hideOverlay();
    shopify.toast.show(
      result.intent === "delete" ? "Region deleted" : "Region saved",
    );
  }, [fetcher.data, busy, shopify]);

  return (
    <s-page heading="Shipping regions">
      <s-link slot="breadcrumb-actions" href={ratesPaths.hub}>
        Rates
      </s-link>
      <s-section heading="Regions">
        <s-stack gap="base">
          {regions.length === 0 ? (
            <s-paragraph>
              Choose the countries ShipFlow should serve. Add your first region
              to get started.
            </s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Region</s-table-header>
                <s-table-header listSlot="labeled">Coverage</s-table-header>
                <s-table-header listSlot="labeled">Rates</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {regions.map((region) => (
                  <s-table-row key={region.id}>
                    <s-table-cell>{region.name}</s-table-cell>
                    <s-table-cell>
                      {region.kind === "REST"
                        ? "Destinations outside named regions"
                        : region.coverage.map(coverageLabel).join(" · ")}
                    </s-table-cell>
                    <s-table-cell>{region.rateCount}</s-table-cell>
                    <s-table-cell>
                      {region.kind !== "REST" ? (
                        <s-stack direction="inline" gap="small">
                          <s-button
                            variant="tertiary"
                            disabled={busy || editing || deleting}
                            onClick={() => {
                              setError(undefined);
                              edit({
                                id: region.id,
                                name: region.name,
                                coverage: region.coverage.map((row) => ({
                                  country: row.country,
                                  provinces: row.provinces.join(", "),
                                })),
                              });
                            }}
                          >
                            Edit
                          </s-button>
                          <s-button
                            variant="tertiary"
                            disabled={!canDelete || busy || editing || deleting}
                            onClick={() => {
                              setError(undefined);
                              confirm(region);
                            }}
                          >
                            Delete
                          </s-button>
                        </s-stack>
                      ) : null}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {regions.length > 0 && !canDelete ? (
            <s-paragraph>Keep at least one named region.</s-paragraph>
          ) : null}
          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant="primary"
              disabled={busy || editing || deleting}
              onClick={() => {
                setError(undefined);
                edit({
                  id: "",
                  name: "",
                  coverage: [{ country: "", provinces: "" }],
                });
              }}
            >
              Create region
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
      <s-modal
        ref={editor as never}
        heading={draft?.id ? "Edit region" : "Create region"}
        onAfterHide={() => edit(null)}
      >
        {draft ? (
          <s-stack gap="base">
            {error ? <s-banner tone="critical" heading={error} /> : null}
            <s-text-field
              label="Region name"
              value={draft.name}
              required
              maxLength={120}
              disabled={busy}
              onInput={(e) => edit({ ...draft, name: e.currentTarget.value })}
            />
            {draft.coverage.map((entry, index) => (
              <s-grid
                key={index}
                gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr) auto"
                gap="base"
                alignItems="end"
              >
                <s-select
                  label="Country"
                  value={entry.country}
                  placeholder="Choose a country"
                  required
                  disabled={busy}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      coverage: draft.coverage.map((item, at) =>
                        at === index
                          ? { country: e.currentTarget.value, provinces: "" }
                          : item,
                      ),
                    })
                  }
                >
                  {countries.map(({ code, label }) => (
                    <s-option key={code} value={code}>
                      {label}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  label="Province or state codes"
                  value={entry.provinces}
                  disabled={busy}
                  placeholder="All provinces"
                  details="Optional. Enter codes such as ON, QC."
                  onInput={(e) =>
                    edit({
                      ...draft,
                      coverage: draft.coverage.map((item, at) =>
                        at === index
                          ? { ...item, provinces: e.currentTarget.value }
                          : item,
                      ),
                    })
                  }
                />
                <s-button
                  variant="tertiary"
                  disabled={busy || draft.coverage.length <= 1}
                  onClick={() =>
                    edit({
                      ...draft,
                      coverage: draft.coverage.filter((_, at) => at !== index),
                    })
                  }
                >
                  Remove
                </s-button>
              </s-grid>
            ))}
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                disabled={busy || draft.coverage.length >= 250}
                onClick={() =>
                  edit({
                    ...draft,
                    coverage: [
                      ...draft.coverage,
                      { country: "", provinces: "" },
                    ],
                  })
                }
              >
                Add country
              </s-button>
            </s-stack>
          </s-stack>
        ) : null}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          disabled={busy}
          onClick={() => editor.current?.hideOverlay()}
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={
            busy ||
            !draft?.name.trim() ||
            draft.coverage.some((entry) => !entry.country)
          }
          onClick={() => {
            if (!draft) return;
            fetcher.submit(
              {
                intent: "save",
                name: draft.name,
                id: draft.id,
                coverage: JSON.stringify(
                  draft.coverage.map((item) => ({
                    country: item.country,
                    provinces: item.provinces.split(","),
                  })),
                ),
              },
              { method: "post" },
            );
          }}
        >
          Save region
        </s-button>
      </s-modal>
      <s-modal
        ref={del as never}
        heading={target ? `Delete ${target.name}?` : "Delete region?"}
        onAfterHide={() => confirm(null)}
      >
        {error ? <s-banner tone="critical" heading={error} /> : null}
        <s-paragraph>
          This removes the region and its {target?.rateCount ?? 0} attached
          rates. Review any other regions that could now match these
          destinations.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          disabled={busy}
          onClick={() => del.current?.hideOverlay()}
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          disabled={busy || !target}
          onClick={() => {
            if (target)
              fetcher.submit(
                {
                  intent: "delete",
                  id: target.id,
                  expectedCount: String(target.rateCount),
                },
                { method: "post" },
              );
          }}
        >
          Delete region
        </s-button>
      </s-modal>
    </s-page>
  );
}

function coverageLabel({ country, provinces }: Coverage) {
  const label =
    countries.find(({ code }) => code === country)?.label ?? country;
  return provinces.length > 0 ? `${label} (${provinces.join(", ")})` : label;
}
