import { BorderedCard } from "../components/bordered-card";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useFetcher,
  useBlocker,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  allowedOperators,
  advancedProductScopes,
  basicScopes,
  conditionDefinitions,
  countries,
  operatorLabels,
  rateIdPattern,
  ratesPaths,
  validateRateCondition,
  validateRateDraft,
  supportsAdvancedScope,
  type ConditionDraft,
  type RateDraft,
  type ScenarioDraft,
} from "../models/calculated-rates";
import {
  getScenario,
  listRegions,
  loadRatesContext,
  rateFormFailure,
  RateFormError,
  saveScenario,
} from "../models/calculated-rates.server";
import { requireRatesStore } from "../models/rates-access.server";
import { settingsTabPath } from "../components/checkout-settings-panels";
import { getStorePricingContext } from "../models/carrier-shopify.server";
import { getUpsConnection } from "../models/live-carrier.server";
import type { ShippingConfiguration } from "../models/checkout-settings";
import {
  RatePricingEditor,
  rateSummary,
} from "../components/rate-pricing-editor";

const SAVE_BAR = "scenario-save-bar";
const empty: ScenarioDraft = {
  name: "",
  active: false,
  conditions: [],
  rates: [],
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  const id = params.id;
  const creating = id === "new";
  if (!creating && (!id || !rateIdPattern.test(id)))
    throw new Response("Scenario not found.", { status: 404 });
  const [saved, context, connection] = await Promise.all([
    creating ? null : getScenario(store.id, id!),
    loadRatesContext(admin.graphql, store),
    getUpsConnection(store.id),
  ]);
  if (!creating && !saved)
    throw new Response("Scenario not found.", { status: 404 });
  return {
    id: id!,
    creating,
    revision: saved?.revision ?? null,
    draft: saved?.draft ?? empty,
    regions: await listRegions(store.id),
    connection,
    currency: context?.currency ?? null,
    weightUnit: store.settings.weightUnit,
    dimensionUnit: store.settings.dimensionUnit,
    distanceUnit: store.settings.distanceUnit,
    manualCodes: Boolean(
      (store.settings.shippingConfiguration as ShippingConfiguration | null)
        ?.manualCodes,
    ),
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, store } = await requireRatesStore(request, true);
  const form = await request.formData();
  const id = params.id === "new" ? null : params.id;
  try {
    if (id === undefined || (id && !rateIdPattern.test(id)))
      throw new RateFormError("Scenario not found.");
    const raw = form.get("draft");
    const revision = form.get("revision");
    if (typeof raw !== "string" || raw.length > 90_000)
      throw new RateFormError("The scenario values could not be read.");
    const { currency } = await getStorePricingContext(admin.graphql).catch(
      () => {
        throw new RateFormError(
          "Shopify could not provide the store currency. Try again.",
        );
      },
    );
    if (currency !== form.get("currency"))
      throw new RateFormError(
        "The store currency changed. Reopen the scenario and try again.",
      );
    const saved = await saveScenario(
      store.shopDomain,
      id,
      typeof revision === "string" ? revision : null,
      JSON.parse(raw),
      currency,
    );
    return {
      ok: true as const,
      id: saved.id,
      revision: saved.updatedAt.toISOString(),
    };
  } catch (error) {
    return rateFormFailure(error);
  }
}

type Initial = Awaited<ReturnType<typeof loader>>;
type Entry =
  | { type: "condition"; index: number; value: ConditionDraft }
  | { type: "rate"; value: RateDraft };

export default function ScenarioPage() {
  const initial = useLoaderData<typeof loader>();
  return <ScenarioEditor key={initial.id} initial={initial} />;
}

function ScenarioEditor({ initial }: { initial: Initial }) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState<ScenarioDraft>(initial.draft);
  const [saved, setSaved] = useState<ScenarioDraft>(initial.draft);
  const [revision, setRevision] = useState(initial.revision);
  const [newId, setNewId] = useState<string>();
  const [error, setError] = useState<string>();
  const [entryError, setEntryError] = useState<string>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const blocked = useBlocker(dirty);
  const saving = fetcher.state !== "idle";
  const open = entry !== null;
  const locked = !ready || saving;
  const canSave =
    dirty && !locked && Boolean(initial.currency && draft.name.trim());

  useEffect(() => {
    let mounted = true;
    void Promise.all(
      ["s-select", "s-text-field", "s-text-area"].map((tag) =>
        customElements.whenDefined(tag),
      ),
    ).then(() =>
      window.requestAnimationFrame(() => {
        if (mounted) setReady(true);
      }),
    );
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (dirty) void shopify.saveBar.show?.(SAVE_BAR);
    else void shopify.saveBar.hide?.(SAVE_BAR);
  }, [dirty, shopify]);
  useEffect(
    () => () => {
      void shopify.saveBar.hide?.(SAVE_BAR);
    },
    [shopify],
  );
  useEffect(() => {
    if (blocked.state !== "blocked") return;
    blocked.reset();
    void shopify.saveBar.leaveConfirmation?.();
  }, [blocked, shopify]);
  useEffect(() => {
    if (open) modal.current?.showOverlay();
  }, [open]);
  useEffect(() => {
    const result = fetcher.data;
    if (saving || !result || handled.current === result) return;
    handled.current = result;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next = initial.creating ? draft : initial.draft;
    setSaved(next);
    setDraft(next);
    setRevision(result.revision);
    setError(undefined);
    if (initial.creating) setNewId(result.id);
    shopify.toast.show("Scenario saved");
  }, [fetcher.data, saving, initial.creating, initial.draft, draft, shopify]);
  useEffect(() => {
    if (newId && !dirty)
      void navigate(ratesPaths.scenario(newId), { replace: true });
  }, [newId, dirty, navigate]);

  function save() {
    if (!canSave || !initial.currency) return;
    fetcher.submit(
      {
        draft: JSON.stringify(draft),
        revision: revision ?? "",
        currency: initial.currency,
      },
      { method: "post" },
    );
  }

  function editEntry(value: Entry) {
    setEntryError(undefined);
    setEntry(value);
  }

  function saveEntry() {
    if (!entry || !initial.currency) return;
    try {
      if (entry.type === "condition") {
        const values = validateRateCondition(
          entry.value,
          initial.currency,
          initial.weightUnit,
          initial.dimensionUnit,
          initial.distanceUnit,
        );
        const conditions = [...draft.conditions];
        conditions[entry.index] = values;
        setDraft({ ...draft, conditions });
      } else {
        const rate = validateRateDraft(
          entry.value,
          initial.currency,
          initial.weightUnit,
          initial.dimensionUnit,
          initial.distanceUnit,
        );
        const exists = draft.rates.some((rate) => rate.id === entry.value.id);
        const next = {
          ...entry.value,
          name: rate.name,
          description: rate.description,
          pricing: rate.pricing,
          liveCarrier: rate.liveCarrier,
          serviceCode: rate.serviceCode,
          minDays: rate.minDays,
          maxDays: rate.maxDays,
        };
        setDraft({
          ...draft,
          rates: exists
            ? draft.rates.map((rate) => (rate.id === next.id ? next : rate))
            : [...draft.rates, next],
        });
      }
      modal.current?.hideOverlay();
    } catch (error) {
      setEntryError(
        error instanceof Error
          ? error.message
          : "Check the values and try again.",
      );
    }
  }

  return (
    <s-page heading={initial.creating ? "Create scenario" : "Edit scenario"}>
      <s-link slot="breadcrumb-actions" href={ratesPaths.scenarios}>
        Scenarios
      </s-link>
      <ui-save-bar id={SAVE_BAR}>
        <button
          type="button"
          variant="primary"
          disabled={!canSave}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDraft(saved);
            setError(undefined);
            setVersion((n) => n + 1);
          }}
        >
          Discard
        </button>
      </ui-save-bar>
      <s-stack gap="base" key={version}>
        {error ? (
          <s-banner tone="critical" heading="Scenario was not saved">
            <s-paragraph>{error}</s-paragraph>
          </s-banner>
        ) : null}
        {!initial.currency ? (
          <s-banner tone="warning" heading="Shopify currency is unavailable">
            <s-paragraph>
              Reload to check the store currency before saving.
            </s-paragraph>
          </s-banner>
        ) : null}
        <BorderedCard heading="Scenario details">
          <s-stack gap="base">
            <s-text-field
              label="Scenario name"
              required
              maxLength={120}
              value={draft.name}
              disabled={locked}
              onInput={(event) =>
                setDraft({ ...draft, name: event.currentTarget.value })
              }
            />
            <s-select
              label="Status"
              value={draft.active ? "active" : "inactive"}
              disabled={locked}
              details={
                initial.connected
                  ? "Only active scenarios can return rates."
                  : "Connect calculated shipping before activating this scenario."
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  active: e.currentTarget.value === "active",
                })
              }
            >
              <s-option value="inactive">Inactive</s-option>
              <s-option value="active" disabled={!initial.connected}>
                Active
              </s-option>
            </s-select>
          </s-stack>
        </BorderedCard>
        <BorderedCard heading="Conditions">
          <s-stack gap="base">
            {draft.conditions.length === 0 ? (
              <s-paragraph>
                Without conditions, this scenario matches every cart in its
                regions.
              </s-paragraph>
            ) : null}
            {draft.conditions.map((value, index) => (
              <s-stack key={index} gap="small-200">
                {index > 0 ? (
                  <s-stack direction="inline" justifyContent="center">
                    <s-badge>AND</s-badge>
                  </s-stack>
                ) : null}
                <s-box padding="base" border="base base solid" borderRadius="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                    gap="small"
                  >
                    <s-text>
                      {conditionDefinitions[value.field].group} ·{" "}
                      {conditionDefinitions[value.field].label} ·{" "}
                      {operatorLabels[value.operator]} {value.value}
                      {value.upper ? ` and ${value.upper}` : ""}
                    </s-text>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant="tertiary"
                        icon="edit"
                        accessibilityLabel={`Edit condition ${index + 1}`}
                        disabled={locked || open}
                        onClick={() =>
                          editEntry({ type: "condition", index, value })
                        }
                      />
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        icon="delete"
                        accessibilityLabel={`Remove condition ${index + 1}`}
                        disabled={locked}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            conditions: draft.conditions.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      />
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-stack>
            ))}
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                disabled={
                  locked ||
                  open ||
                  !initial.currency ||
                  draft.conditions.length >= 30
                }
                onClick={() =>
                  editEntry({
                    type: "condition",
                    index: draft.conditions.length,
                    value: { field: "cartTotal", operator: "gte", value: "" },
                  })
                }
              >
                Add condition
              </s-button>
            </s-stack>
          </s-stack>
        </BorderedCard>
        <BorderedCard heading="Regions and rates">
          <s-stack gap="base">
            {initial.regions.length === 0 ? (
              <s-paragraph>
                Create a shipping region before adding rates.
              </s-paragraph>
            ) : null}
            {initial.regions.map((region) => {
              const rows = draft.rates.filter(
                (rate) => rate.regionId === region.id,
              );
              return (
                <s-box
                  padding="base"
                  border="base base solid"
                  borderRadius="base"
                  key={region.id}
                >
                  <s-stack gap="small">
                    <s-heading>{region.name}</s-heading>
                    {rows.length === 0 ? (
                      <s-paragraph>No rates</s-paragraph>
                    ) : (
                      rows.map((value) => (
                        <s-stack
                          key={value.id}
                          direction="inline"
                          justifyContent="space-between"
                          alignItems="center"
                          gap="small"
                        >
                          <s-text>
                            {value.name} ·{" "}
                            {rateSummary(value, initial.currency ?? "")}
                          </s-text>
                          {value.active === false ? (
                            <s-badge tone="neutral">Inactive</s-badge>
                          ) : null}
                          <s-stack direction="inline" gap="small">
                            <s-button
                              variant="tertiary"
                              icon="edit"
                              accessibilityLabel={`Edit rate ${value.name}`}
                              disabled={locked || open}
                              onClick={() => editEntry({ type: "rate", value })}
                            />
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              icon="delete"
                              accessibilityLabel={`Remove rate ${value.name}`}
                              disabled={locked}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  rates: draft.rates.filter(
                                    (rate) => rate.id !== value.id,
                                  ),
                                })
                              }
                            />
                          </s-stack>
                        </s-stack>
                      ))
                    )}
                    <s-stack direction="inline" justifyContent="end">
                      <s-button
                        variant="secondary"
                        disabled={
                          locked ||
                          open ||
                          !initial.currency ||
                          draft.rates.length >= 100
                        }
                        onClick={() =>
                          editEntry({
                            type: "rate",
                            value: {
                              id: crypto.randomUUID(),
                              regionId: region.id,
                              name: "",
                              description: "",
                              price: "",
                            },
                          })
                        }
                      >
                        Add rate
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-box>
              );
            })}
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                href={settingsTabPath("regions")}
              >
                Manage regions
              </s-button>
            </s-stack>
          </s-stack>
        </BorderedCard>
        <s-stack direction="inline" justifyContent="end" gap="small">
          <s-button variant="secondary" href={ratesPaths.scenarios}>
            Back
          </s-button>
          <s-button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={save}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
      <s-modal
        id="scenario-entry-modal"
        ref={modal as never}
        heading={
          entry?.type === "rate" ? "Shipping rate" : "Scenario condition"
        }
        size={entry?.type === "rate" ? "large" : "base"}
        onAfterHide={() => setEntry(null)}
      >
        <s-stack gap="base">
          {entryError ? (
            <s-banner tone="critical">
              <s-paragraph>{entryError}</s-paragraph>
            </s-banner>
          ) : null}
          {entry?.type === "condition" ? (
            <ConditionEditor
              value={entry.value}
              currency={initial.currency ?? ""}
              weightUnit={initial.weightUnit}
              dimensionUnit={initial.dimensionUnit}
              distanceUnit={initial.distanceUnit}
              change={(value) => {
                setEntryError(undefined);
                setEntry({ ...entry, value });
              }}
            />
          ) : entry?.type === "rate" ? (
            <RatePricingEditor
              value={entry.value}
              connection={initial.connection}
              currency={initial.currency ?? ""}
              weightUnit={initial.weightUnit}
              dimensionUnit={initial.dimensionUnit}
              distanceUnit={initial.distanceUnit}
              manualCodes={initial.manualCodes}
              change={(value) => {
                setEntryError(undefined);
                setEntry({ ...entry, value });
              }}
            />
          ) : null}
        </s-stack>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor="scenario-entry-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button slot="primary-action" variant="primary" onClick={saveEntry}>
          Apply
        </s-button>
      </s-modal>
    </s-page>
  );
}

function ConditionEditor({
  value,
  currency,
  weightUnit,
  dimensionUnit,
  distanceUnit,
  change,
}: {
  value: ConditionDraft;
  currency: string;
  weightUnit: string;
  dimensionUnit: string;
  distanceUnit: string;
  change: (value: ConditionDraft) => void;
}) {
  const current = conditionDefinitions[value.field];
  const fields = Object.keys(conditionDefinitions) as ConditionDraft["field"][];
  const reset = (field: ConditionDraft["field"]) =>
    change({ field, operator: allowedOperators(field)[0], value: "" });
  const withUnit =
    current.kind === "money"
      ? `Value (${currency})`
      : current.kind === "weight"
        ? `Value (${value.weightUnit ?? weightUnit})`
        : current.kind === "dimension"
          ? `Value (${value.dimensionUnit ?? dimensionUnit})`
          : current.kind === "distance"
            ? `Value (${value.distanceUnit ?? distanceUnit})`
            : current.kind === "volumetric"
              ? "Value (kg)"
              : current.kind === "volume"
                ? "Value (cm³)"
                : "Value";
  return (
    <s-stack gap="base">
      <s-select
        label="Category"
        value={current.group}
        onChange={(e) => {
          const first = fields.find(
            (field) =>
              conditionDefinitions[field].group === e.currentTarget.value,
          );
          if (first) reset(first);
        }}
      >
        <s-option value="Cart">Cart</s-option>
        <s-option value="Product">Product</s-option>
        <s-option value="Customer">Customer</s-option>
      </s-select>
      <s-select
        label="Field"
        value={value.field}
        onChange={(e) =>
          reset(e.currentTarget.value as ConditionDraft["field"])
        }
      >
        {fields
          .filter(
            (field) => conditionDefinitions[field].group === current.group,
          )
          .map((field) => (
            <s-option key={field} value={field}>
              {conditionDefinitions[field].label}
            </s-option>
          ))}
      </s-select>
      <s-select
        label="Operator"
        key={`operator-${value.field}`}
        value={value.operator}
        onChange={(e) =>
          change({
            ...value,
            operator: e.currentTarget.value as ConditionDraft["operator"],
          })
        }
      >
        {allowedOperators(value.field).map((operator) => (
          <s-option key={operator} value={operator}>
            {operatorLabels[operator]}
          </s-option>
        ))}
      </s-select>
      {value.field === "province" ? (
        <s-select
          label="Province or state country"
          value={value.provinceCountry ?? ""}
          onChange={(event) =>
            change({ ...value, provinceCountry: event.currentTarget.value })
          }
        >
          <s-option value="">Any country</s-option>
          {countries.map(({ code, label }) => (
            <s-option key={code} value={code}>
              {label}
            </s-option>
          ))}
        </s-select>
      ) : null}
      <s-text-field
        label={
          value.operator === "between"
            ? `Minimum ${withUnit.toLowerCase()}`
            : withUnit
        }
        key={`entry-${value.field}`}
        value={value.value}
        required
        details={
          current.kind === "text" || current.kind === "exact"
            ? "Separate multiple values with commas."
            : current.kind === "postal"
              ? "Separate codes, 1004* prefixes, 100400:100500 ranges, or HB1_ space prefixes with commas."
              : undefined
        }
        onInput={(e) => change({ ...value, value: e.currentTarget.value })}
      />
      {value.operator === "between" ? (
        <s-text-field
          label={`Maximum ${withUnit.toLowerCase()}`}
          value={value.upper ?? ""}
          required
          onInput={(e) => change({ ...value, upper: e.currentTarget.value })}
        />
      ) : null}
      {current.group === "Product" ? (
        <s-select
          label="Apply to"
          value={value.scope ?? "any"}
          onChange={(e) =>
            change({
              ...value,
              scope: e.currentTarget.value as ConditionDraft["scope"],
            })
          }
        >
          {(Object.keys(basicScopes) as (keyof typeof basicScopes)[]).map(
            (scope) => (
              <s-option key={scope} value={scope}>
                {basicScopes[scope]}
              </s-option>
            ),
          )}
          {supportsAdvancedScope(value.field)
            ? (
                Object.keys(
                  advancedProductScopes,
                ) as (keyof typeof advancedProductScopes)[]
              ).map((scope) => (
                <s-option key={scope} value={scope}>
                  {advancedProductScopes[scope]}
                </s-option>
              ))
            : null}
        </s-select>
      ) : null}
      {value.scope &&
      Object.prototype.hasOwnProperty.call(
        advancedProductScopes,
        value.scope,
      ) ? (
        <s-text-field
          label={
            value.scope.startsWith("sku") ? "Scope SKU values" : "Scope tags"
          }
          value={value.scopeValue ?? ""}
          details="Separate values with commas."
          required
          onInput={(event) =>
            change({ ...value, scopeValue: event.currentTarget.value })
          }
        />
      ) : null}
      {current.group === "Product" &&
      ["weight", "volume", "volumetric"].includes(current.kind) ? (
        <s-checkbox
          label="Use individual unit value"
          checked={value.individual ?? false}
          onChange={(e) =>
            change({ ...value, individual: e.currentTarget.checked })
          }
        />
      ) : null}
    </s-stack>
  );
}
