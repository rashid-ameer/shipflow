import { CountryCheckboxDropdown } from "./country-checkbox-dropdown";
import { IndexTableRowActions, IndexTableSection } from "./index-table";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  countries,
  ratesPaths,
  type Coverage,
} from "../models/calculated-rates";
import type { listRegions } from "../models/calculated-rates.server";
import type { action } from "../routes/app.rates.regions";
import {
  clampIndexPage,
  INDEX_PAGE_SIZE,
  indexPageCount,
} from "../pagination";

type Regions = Awaited<ReturnType<typeof listRegions>>;
type RegionEditor = {
  id: string;
  name: string;
  countries: string[];
  provinces: Record<string, string[]>;
};

const newRegion = (): RegionEditor => ({
  id: "",
  name: "",
  countries: [],
  provinces: {},
});

const coverageToEditor = (coverage: Coverage[]) => ({
  countries: coverage.map(({ country }) => country),
  provinces: coverage.reduce<Record<string, string[]>>((result, entry) => {
    if (entry.provinces.length > 0) {
      result[entry.country] = entry.provinces;
    }
    return result;
  }, {}),
});

export function RegionsManager({
  regions,
  inlineCreateAction = false,
}: {
  regions: Regions;
  inlineCreateAction?: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [draft, edit] = useState<RegionEditor | null>(null);
  const [target, confirm] = useState<Regions[number] | null>(null);
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(1);
  const editor = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const del = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const busy = fetcher.state !== "idle";
  const canDelete = regions.filter((row) => row.kind !== "REST").length > 1;
  const pageCount = indexPageCount(regions.length);
  const currentPage = clampIndexPage(page, regions.length);
  const pageRegions = regions.slice(
    (currentPage - 1) * INDEX_PAGE_SIZE,
    currentPage * INDEX_PAGE_SIZE,
  );

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
    const completedModal = result.intent === "delete" ? del : editor;
    completedModal.current?.hideOverlay();
    shopify.toast.show(
      result.intent === "delete" ? "Region deleted" : "Region saved",
    );
  }, [fetcher.data, busy, shopify]);

  function startCreate() {
    setError(undefined);
    edit(newRegion());
  }

  const keepOneRegionNotice =
    regions.length > 0 && !canDelete ? (
      <s-paragraph>Keep at least one named region.</s-paragraph>
    ) : null;

  const table = (
    <>
      <IndexTableSection
        label="Regions"
        paginate={pageCount > 1}
        hasPreviousPage={currentPage > 1}
        hasNextPage={currentPage < pageCount}
        onPreviousPage={() => setPage(currentPage - 1)}
        onNextPage={() => setPage(currentPage + 1)}
      >
        <s-table-header-row>
          <s-table-header listSlot="primary">Region</s-table-header>
          <s-table-header listSlot="labeled">Coverage</s-table-header>
          <s-table-header listSlot="labeled">Rates</s-table-header>
          <s-table-header>Actions</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {pageRegions.map((region) => (
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
                    <IndexTableRowActions id={region.id} label={region.name}>
                      <s-button
                        icon="edit"
                        disabled={busy || editing || deleting}
                        onClick={() => {
                          setError(undefined);
                          edit({
                            id: region.id,
                            name: region.name,
                            ...coverageToEditor(region.coverage),
                          });
                        }}
                      >
                        Edit region
                      </s-button>
                      <s-button
                        icon="delete"
                        tone="critical"
                        disabled={!canDelete || busy || editing || deleting}
                        onClick={() => {
                          setError(undefined);
                          confirm(region);
                        }}
                      >
                        Delete region
                      </s-button>
                    </IndexTableRowActions>
                  ) : null}
                </s-table-cell>
            </s-table-row>
          ))}
          {regions.length === 0 ? (
            <s-empty-state heading="Add your first region">
              <s-text slot="subheading">
                Choose the countries ShipFlow should serve.
              </s-text>
            </s-empty-state>
          ) : null}
        </s-table-body>
      </IndexTableSection>
      {pageCount > 1 ? (
        <s-text color="subdued">
          {currentPage} of {pageCount}
        </s-text>
      ) : null}
    </>
  );

  return (
    <>
      {inlineCreateAction ? (
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="base"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-heading>Regions</s-heading>
            <s-button
              variant="primary"
              disabled={busy || editing || deleting}
              onClick={startCreate}
            >
              Create region
            </s-button>
          </s-stack>
          {keepOneRegionNotice}
          {table}
        </s-stack>
      ) : (
        <>
          <s-button
            slot="primary-action"
            variant="primary"
            disabled={busy || editing || deleting}
            onClick={startCreate}
          >
            Create region
          </s-button>
          {keepOneRegionNotice}
          {table}
        </>
      )}
      <s-modal
        id="region-editor-modal"
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
            <CountryCheckboxDropdown
              id="region-countries"
              selected={draft.countries}
              provinces={draft.provinces}
              disabled={busy}
              onChange={(codes) => edit({ ...draft, countries: codes })}
              onProvincesChange={(provinces) =>
                edit({ ...draft, provinces })
              }
            />
          </s-stack>
        ) : null}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          disabled={busy}
          commandFor="region-editor-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={busy || !draft?.name.trim() || draft.countries.length === 0}
          onClick={() => {
            if (!draft) return;
            fetcher.submit(
              {
                intent: "save",
                name: draft.name,
                id: draft.id,
                coverage: JSON.stringify(
                  draft.countries.map((country) => ({
                    country,
                    provinces: draft.provinces[country] ?? [],
                  })),
                ),
              },
              { method: "post", action: ratesPaths.regions },
            );
          }}
        >
          Save region
        </s-button>
      </s-modal>
      <s-modal
        id="delete-region-modal"
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
          commandFor="delete-region-modal"
          command="--hide"
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
                { method: "post", action: ratesPaths.regions },
              );
          }}
        >
          Delete region
        </s-button>
      </s-modal>
    </>
  );
}

function coverageLabel({ country, provinces }: Coverage) {
  const label =
    countries.find(({ code }) => code === country)?.label ?? country;
  return provinces.length > 0 ? `${label} (${provinces.join(", ")})` : label;
}
