import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useBlocker,
  useFetcher,
  useLoaderData,
  useNavigate,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  combinedPaths,
  combinationMethods,
  emptyCombinedDraft,
  validateCombinedDraft,
  type CombinedDraft,
} from "../models/combined-rates";
import {
  combinedEditorData,
  getCombinedRule,
  saveCombinedRule,
} from "../models/combined-rates.server";
import { rateIdPattern } from "../models/calculated-rates";
import {
  rateFormFailure,
  RateFormError,
} from "../models/calculated-rates.server";
import { requireRatesStore } from "../models/rates-access.server";

const saveBarId = "combined-rate-save-bar";
const optionalTags = [
  {
    field: "excludedTags",
    toggle: "Exclude tagged rates from the price",
    label: "Tags to exclude",
    details: "Rates with these tags stay separate.",
    maxLength: 1850,
  },
  {
    field: "blockingTags",
    toggle: "Skip this rule when blocking tags are present",
    label: "Blocking tags",
    details: "Skip this rule when an available rate has one of these tags.",
    maxLength: 1850,
  },
  {
    field: "outputTag",
    toggle: "Add a tag for another combined rate",
    label: "Output tag",
    details: "A later rule can use this tag to combine this result.",
    maxLength: 60,
  },
] as const;
type OptionalTag = (typeof optionalTags)[number]["field"];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { store } = await requireRatesStore(request);
  const id = params.id;
  if (!id || (id !== "new" && !rateIdPattern.test(id)))
    throw new Response("Combined rate not found.", { status: 404 });
  const saved = id === "new" ? null : await getCombinedRule(store.id, id);
  if (id !== "new" && !saved)
    throw new Response("Combined rate not found.", { status: 404 });
  return {
    id,
    draft: saved?.draft ?? emptyCombinedDraft,
    revision: saved?.revision ?? "",
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { store } = await requireRatesStore(request, true);
  const form = await request.formData();
  try {
    const id = params.id;
    const raw = form.get("draft");
    const revision = form.get("revision");
    if (
      !id ||
      (id !== "new" && !rateIdPattern.test(id)) ||
      typeof raw !== "string" ||
      raw.length > 9000 ||
      typeof revision !== "string"
    )
      throw new RateFormError("The combined rate could not be read.");
    const saved = await saveCombinedRule(
      store.shopDomain,
      id === "new" ? null : id,
      revision,
      JSON.parse(raw),
    );
    return {
      ok: true as const,
      id: saved.id,
      ...combinedEditorData(saved),
    };
  } catch (error) {
    return rateFormFailure(error);
  }
}

export default function CombinedRatePage() {
  const initial = useLoaderData<typeof loader>();
  return <CombinedEditor key={initial.id} initial={initial} />;
}

function CombinedEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof loader>>;
}) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial.draft);
  const [saved, setSaved] = useState(initial.draft);
  const [revision, setRevision] = useState(initial.revision);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [tagVisibility, setTagVisibility] = useState<
    Partial<Record<OptionalTag, boolean>>
  >({});
  const received = useRef<typeof fetcher.data>(undefined);
  const saving = fetcher.state !== "idle";
  const locked = saving || !ready;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    optionalTags.some(
      ({ field }) => tagEnabled(field) !== Boolean(saved[field]),
    );
  const canSave = dirty && !locked;
  const blocker = useBlocker(dirty);
  const creating = initial.id === "new";

  useEffect(() => {
    void Promise.all(
      [
        "s-select",
        "s-text-field",
        "s-text-area",
        "s-checkbox",
        "s-number-field",
      ].map((tag) => customElements.whenDefined(tag)),
    ).then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (dirty) void shopify.saveBar.show(saveBarId);
    else void shopify.saveBar.hide(saveBarId);
  }, [dirty, shopify]);
  useEffect(
    () => () => {
      void shopify.saveBar.hide(saveBarId);
    },
    [shopify],
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset();
      void shopify.saveBar.leaveConfirmation();
    }
  }, [blocker, shopify]);
  useEffect(() => {
    const result = fetcher.data;
    if (saving || !result || received.current === result) return;
    received.current = result;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(result.draft);
    setSaved(result.draft);
    setTagVisibility({});
    setRevision(result.revision);
    setError("");
    setVersion((current) => current + 1);
    shopify.toast.show("Combined rate saved");
    if (creating) setNewId(result.id);
  }, [fetcher.data, saving, creating, shopify]);
  useEffect(() => {
    if (newId && !dirty)
      void navigate(combinedPaths.editor(newId), { replace: true });
  }, [newId, dirty, navigate]);

  function patch(update: Partial<CombinedDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setError("");
  }
  function tagEnabled(field: OptionalTag) {
    return tagVisibility[field] ?? Boolean(draft[field]);
  }
  function save() {
    if (!canSave) return;
    try {
      const rule = validateCombinedDraft(draft);
      const missingTag = optionalTags.find(
        ({ field }) => tagEnabled(field) && !rule[field].length,
      );
      if (missingTag)
        throw new Error(`Enter a value for ${missingTag.label.toLowerCase()}.`);
      fetcher.submit(
        { draft: JSON.stringify(draft), revision },
        { method: "post" },
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Check the rate details and try again.",
      );
    }
  }
  function discard() {
    setDraft(saved);
    setTagVisibility({});
    setError("");
    setVersion((current) => current + 1);
  }
  function back(event?: { preventDefault: () => void }) {
    if (!dirty) return;
    event?.preventDefault();
    void shopify.saveBar.leaveConfirmation();
  }

  return (
    <s-page heading={creating ? "Add combined rate" : "Edit combined rate"}>
      <s-link
        slot="breadcrumb-actions"
        href={combinedPaths.list}
        onClick={back}
      >
        Combined rates
      </s-link>
      <ui-save-bar id={saveBarId}>
        <button
          type="button"
          variant="primary"
          disabled={!canSave}
          onClick={save}
        >
          Save
        </button>
        <button type="button" disabled={saving} onClick={discard}>
          Discard
        </button>
      </ui-save-bar>
      <s-stack gap="base" key={version}>
        {error ? (
          <s-banner
            tone="critical"
            heading="The combined rate could not be saved"
          >
            <s-paragraph>{error}</s-paragraph>
          </s-banner>
        ) : null}
        <s-section heading="Checkout details">
          <s-stack gap="base">
            <s-text-field
              label="Shipping rate name"
              required
              maxLength={120}
              value={draft.name}
              disabled={locked}
              onInput={(event) => patch({ name: event.currentTarget.value })}
            />
            <s-text-area
              label="Checkout description"
              maxLength={250}
              value={draft.description}
              disabled={locked}
              onInput={(event) =>
                patch({ description: event.currentTarget.value })
              }
            />
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 200px), 1fr))"
              gap="base"
            >
              <s-number-field
                label="Earliest delivery (days)"
                inputMode="numeric"
                min={0}
                max={365}
                step={1}
                value={draft.minDays}
                disabled={locked}
                onInput={(event) =>
                  patch({ minDays: event.currentTarget.value })
                }
              />
              <s-number-field
                label="Latest delivery (days)"
                inputMode="numeric"
                min={0}
                max={365}
                step={1}
                value={draft.maxDays}
                disabled={locked}
                onInput={(event) =>
                  patch({ maxDays: event.currentTarget.value })
                }
              />
            </s-grid>
          </s-stack>
        </s-section>
        <s-section heading="Combine tagged rates">
          <s-stack gap="base">
            <s-text-field
              label="Shipping rate tags to combine"
              required
              maxLength={1850}
              value={draft.tags}
              details="Separate tags with commas."
              disabled={locked}
              onInput={(event) => patch({ tags: event.currentTarget.value })}
            />
            <s-grid
              gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 200px), 1fr))"
              gap="base"
            >
              <s-select
                label="Calculation"
                value={draft.method}
                disabled={locked}
                onChange={(event) => {
                  const method = event.currentTarget
                    .value as CombinedDraft["method"];
                  patch({
                    method,
                    ...(method === "sum" || method === "average"
                      ? { useWinningName: false }
                      : {}),
                  });
                }}
              >
                {(
                  Object.keys(combinationMethods) as CombinedDraft["method"][]
                ).map((value) => (
                  <s-option value={value} key={value}>
                    {combinationMethods[value]}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label="When to combine"
                value={draft.requirement}
                disabled={locked}
                onChange={(event) =>
                  patch({
                    requirement: event.currentTarget
                      .value as CombinedDraft["requirement"],
                  })
                }
              >
                <s-option value="all">All tags must match</s-option>
                <s-option value="any">Any tag can match</s-option>
              </s-select>
            </s-grid>
            {draft.method === "highest" || draft.method === "lowest" ? (
              <s-checkbox
                label="Use the winning rate’s name"
                checked={draft.useWinningName}
                disabled={locked}
                onChange={(event) =>
                  patch({ useWinningName: event.currentTarget.checked })
                }
              />
            ) : null}
            <s-checkbox
              label="Require at least two matching tags"
              checked={draft.requireTwoTags}
              disabled={locked}
              onChange={(event) =>
                patch({ requireTwoTags: event.currentTarget.checked })
              }
            />
            {optionalTags.map(({ field, toggle, label, details, maxLength }) => (
              <s-stack key={field} gap="small">
                <s-checkbox
                  label={toggle}
                  checked={tagEnabled(field)}
                  disabled={locked}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setTagVisibility((current) => ({
                      ...current,
                      [field]: checked,
                    }));
                    patch(checked ? {} : { [field]: "" });
                  }}
                />
                {tagEnabled(field) ? (
                  <s-text-field
                    label={label}
                    details={details}
                    maxLength={maxLength}
                    required
                    value={draft[field]}
                    disabled={locked}
                    onInput={(event) =>
                      patch({ [field]: event.currentTarget.value })
                    }
                  />
                ) : null}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
        <s-section heading="Rule settings">
          <s-stack gap="base">
            <s-select
              label="Status"
              value={draft.active ? "active" : "inactive"}
              disabled={locked}
              details={
                initial.connected
                  ? undefined
                  : "Connect Carrier Service in Rates to activate this rule."
              }
              onChange={(event) =>
                patch({ active: event.currentTarget.value === "active" })
              }
            >
              <s-option value="inactive">Inactive</s-option>
              <s-option
                value="active"
                disabled={!initial.connected && !draft.active}
              >
                Active
              </s-option>
            </s-select>
            <s-text-area
              label="Internal notes"
              maxLength={1000}
              value={draft.notes}
              disabled={locked}
              onInput={(event) => patch({ notes: event.currentTarget.value })}
            />
          </s-stack>
        </s-section>
        <s-stack direction="inline" justifyContent="end" gap="small">
          <s-button href={combinedPaths.list} onClick={back}>
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
    </s-page>
  );
}
