import { BorderedCard } from "../components/bordered-card";
import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  data,
  redirect,
  useBlocker,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  actions,
  conditionFields,
  deliveryCheckoutStatus,
  deliveryMethods,
  deliveryPaths,
  emptyDeliveryRule,
  fieldDetails,
  hasRateMatcher,
  MAX_ACTIONS,
  MAX_CONDITIONS,
  nameOperators,
  operators,
  shippingTitleAction,
  validateDeliveryRule,
  type Condition,
  type DeliveryAction,
  type DeliveryRule,
} from "../models/delivery-customization";
import {
  getDeliveryRule,
  getDeliveryStatus,
  saveDeliveryRule,
  syncErrorMessage,
} from "../models/delivery-customization.server";
import { getOrCreateShop } from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

const SAVE_BAR = "delivery-rule-save-bar";
type Branch = "ifActions" | "elseActions";
type Entry =
  | { kind: "condition"; index: number; value: Condition }
  | { kind: "action"; branch: Branch; index: number; value: DeliveryAction };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (
    store.onboardingStep !== "COMPLETE" ||
    store.mode !== "DELIVERY_CUSTOMIZATION"
  ) {
    throw redirect("/app");
  }
  if (params.id === "new") {
    return {
      creating: true as const,
      id: randomUUID(),
      rule: emptyDeliveryRule(store.settings.weightUnit),
      revision: null,
      status: null,
      issue: null,
      appEnabled: store.appEnabled,
    };
  }
  const row =
    params.id && uuid.test(params.id)
      ? await getDeliveryRule(store.id, params.id)
      : null;
  if (!row) throw new Response("Customization not found.", { status: 404 });
  const result = await getDeliveryStatus(admin.graphql, [row], store);
  return {
    creating: false as const,
    id: row.id,
    rule: row.rule as DeliveryRule,
    revision: row.revision,
    status: result.states[row.id],
    issue: result.issue,
    appEnabled: store.appEnabled,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const creating = params.id === "new";
  const id = creating ? form.get("id") : params.id;
  const savedRevision = form.get("revision");
  const raw = form.get("rule");
  let draft: unknown;
  if (typeof raw === "string" && raw.length <= 20_000) {
    try {
      draft = JSON.parse(raw);
    } catch {
      /* Invalid form data. */
    }
  }
  const validation = validateDeliveryRule(draft);
  if (!validation.ok || typeof id !== "string" || !uuid.test(id)) {
    return data(
      {
        ok: false as const,
        error: validation.ok
          ? "Reopen the editor and try again."
          : validation.error,
      },
      { status: 400 },
    );
  }
  try {
    const saved = await saveDeliveryRule(
      admin.graphql,
      session.shop,
      id,
      creating ? "create" : "edit",
      validation.rule,
      typeof savedRevision === "string" ? savedRevision : null,
    );
    return {
      ok: true as const,
      id: saved.id,
      rule: validation.rule,
      revision: saved.revision,
    };
  } catch (error) {
    if (error instanceof Response && error.status === 404) throw error;
    return data(
      {
        ok: false as const,
        error:
          error instanceof Response
            ? "Switch back to Delivery Customization before saving."
            : syncErrorMessage(error),
      },
      { status: error instanceof Response ? error.status : 422 },
    );
  }
}

export default function DeliveryCustomizationEditor() {
  const initial = useLoaderData<typeof loader>();
  return (
    <Editor key={initial.creating ? "new" : initial.id} initial={initial} />
  );
}

function Editor({ initial }: { initial: Awaited<ReturnType<typeof loader>> }) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [id] = useState(initial.id);
  const [baseline, setBaseline] = useState(initial.rule);
  const [revision, setRevision] = useState(initial.revision);
  const [draft, setDraft] = useState(initial.rule);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entryError, setEntryError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [reset, setReset] = useState(0);
  const [ready, setReady] = useState(false);
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const handled = useRef<typeof fetcher.data>(undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const saving = fetcher.state !== "idle";
  const disabled = saving || !ready;
  const blocked = useBlocker(dirty);
  const valid = validateDeliveryRule(draft);
  const canSave =
    valid.ok && (dirty || initial.status === "out-of-sync") && !saving;

  useEffect(() => {
    let active = true;
    void Promise.all(
      ["s-select", "s-checkbox", "s-text-field"].map((tag) =>
        customElements.whenDefined(tag),
      ),
    ).then(() =>
      window.requestAnimationFrame(() => {
        if (active) setReady(true);
      }),
    );
    return () => {
      active = false;
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
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || handled.current === result)
      return;
    handled.current = result;
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setBaseline(result.rule);
    setDraft(result.rule);
    setRevision(result.revision);
    setSaveError(undefined);
    setReset((version) => version + 1);
    if (initial.creating) setSavedId(result.id);
    shopify.toast.show("Customization saved");
  }, [fetcher.data, fetcher.state, initial.creating, shopify]);

  useEffect(() => {
    if (savedId && !dirty)
      void navigate(deliveryPaths.edit(savedId), { replace: true });
  }, [savedId, dirty, navigate]);

  const modalOpen = entry !== null;
  useEffect(() => {
    if (modalOpen) modal.current?.showOverlay();
  }, [modalOpen]);

  function save() {
    if (!valid.ok || !canSave) return;
    fetcher.submit(
      { id, revision: revision ?? "", rule: JSON.stringify(valid.rule) },
      { method: "post" },
    );
  }

  function discard() {
    setDraft(baseline);
    setSaveError(undefined);
    setReset((version) => version + 1);
  }

  function open(value: Entry) {
    setEntryError(undefined);
    setEntry(value);
  }

  function applyEntry() {
    if (!entry) return;
    const sample = {
      ...draft,
      name: "Customization",
      ifActions: [{ kind: "hide-all" }] as DeliveryAction[],
      elseActions: [],
    };
    if (entry.kind === "condition") {
      const candidate = replaceOrAppend(
        draft.conditions,
        entry.index,
        entry.value,
      );
      const result = validateDeliveryRule({ ...sample, conditions: candidate });
      if (!result.ok) {
        setEntryError(result.error);
        return;
      }
      setDraft({ ...draft, conditions: result.rule.conditions });
    } else {
      const result = validateDeliveryRule({
        ...sample,
        conditions: [],
        ifActions: [entry.value],
      });
      if (!result.ok) {
        setEntryError(result.error);
        return;
      }
      setDraft({
        ...draft,
        [entry.branch]: replaceOrAppend(
          draft[entry.branch],
          entry.index,
          result.rule.ifActions[0],
        ),
      });
    }
    modal.current?.hideOverlay();
  }

  const checkout = initial.status
    ? deliveryCheckoutStatus[initial.status]
    : null;
  return (
    <s-page
      heading={
        initial.creating
          ? "Create delivery customization"
          : "Edit delivery customization"
      }
    >
      <s-link slot="breadcrumb-actions" href={deliveryPaths.list}>
        Delivery customizations
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
        <button type="button" disabled={saving} onClick={discard}>
          Discard
        </button>
      </ui-save-bar>
      <s-stack gap="base" key={reset}>
        {saveError ? (
          <s-banner tone="critical" heading="Customization was not saved">
            <s-paragraph>{saveError} Your edits are still here.</s-paragraph>
            {!initial.creating ? (
              <s-button
                slot="secondary-actions"
                variant="secondary"
                loading={revalidator.state !== "idle"}
                onClick={() => revalidator.revalidate()}
              >
                Refresh checkout status
              </s-button>
            ) : null}
          </s-banner>
        ) : null}
        {initial.issue || initial.status === "out-of-sync" ? (
          <s-banner
            tone="warning"
            heading={
              initial.issue
                ? "Could not check checkout status"
                : "Checkout configuration needs sync"
            }
          >
            <s-paragraph>
              {initial.issue ??
                "Your saved customization and Shopify’s checkout configuration differ. Save to sync them."}
            </s-paragraph>
          </s-banner>
        ) : null}
        <BorderedCard heading="Customization details">
          <s-stack gap="base">
            <s-text-field
              label="Customization name"
              value={draft.name}
              required
              maxLength={120}
              placeholder="Example: Hide pickup for warehouse products"
              disabled={disabled}
              onInput={(event) =>
                setDraft({ ...draft, name: fieldValue(event) })
              }
            />
            <s-select
              label="Condition data scope"
              value={draft.scope}
              disabled={disabled}
              details="The scope determines which checkout fields you can use in conditions."
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scope: fieldValue(event) as DeliveryRule["scope"],
                })
              }
            >
              <s-option value="basic">Basic</s-option>
              <s-option value="advanced">Advanced</s-option>
            </s-select>
            <s-stack gap="small-200">
              <s-heading>Apply this rule to</s-heading>
              {Object.entries(deliveryMethods).map(([key, label]) => {
                const method = key as DeliveryRule["methods"][number];
                return (
                  <s-checkbox
                    key={key}
                    label={label}
                    checked={draft.methods.includes(method)}
                    disabled={disabled}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        methods: event.currentTarget.checked
                          ? [...draft.methods, method]
                          : draft.methods.filter((item) => item !== method),
                      })
                    }
                  />
                );
              })}
            </s-stack>
          </s-stack>
        </BorderedCard>

        <BorderedCard heading="Conditions">
          <s-stack gap="base">
            <s-paragraph>
              {draft.conditions.length
                ? "All conditions must match."
                : "With no conditions, the IF actions run for every checkout."}
            </s-paragraph>
            {draft.conditions.map((item, index) => (
              <EntryRow
                key={index}
                label={conditionSummary(item)}
                index={index}
                count={draft.conditions.length}
                disabled={disabled}
                onEdit={() => open({ kind: "condition", index, value: item })}
                onRemove={() =>
                  setDraft({
                    ...draft,
                    conditions: remove(draft.conditions, index),
                  })
                }
                onMove={(step) =>
                  setDraft({
                    ...draft,
                    conditions: move(draft.conditions, index, step),
                  })
                }
              />
            ))}
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                disabled={disabled || draft.conditions.length >= MAX_CONDITIONS}
                onClick={() =>
                  open({
                    kind: "condition",
                    index: draft.conditions.length,
                    value: blankCondition(
                      draft.scope === "basic" ? "productTag" : "quantity",
                    ),
                  })
                }
              >
                Add condition
              </s-button>
            </s-stack>
          </s-stack>
        </BorderedCard>

        {(["ifActions", "elseActions"] as const).map((branch) => (
          <BorderedCard
            key={branch}
            heading={
              branch === "ifActions"
                ? "IF conditions match"
                : "ELSE conditions do not match"
            }
          >
            <s-stack gap="base">
              <s-paragraph>
                {branch === "ifActions"
                  ? "Actions run in the order shown."
                  : draft.conditions.length
                    ? "Optional actions for checkouts that do not match all conditions."
                    : "Add a condition to use this branch."}
              </s-paragraph>
              {draft[branch].map((item, index) => (
                <EntryRow
                  key={index}
                  label={actionSummary(item)}
                  index={index}
                  count={draft[branch].length}
                  disabled={disabled}
                  onEdit={() =>
                    open({ kind: "action", branch, index, value: item })
                  }
                  onRemove={() =>
                    setDraft({
                      ...draft,
                      [branch]: remove(draft[branch], index),
                    })
                  }
                  onMove={(step) =>
                    setDraft({
                      ...draft,
                      [branch]: move(draft[branch], index, step),
                    })
                  }
                />
              ))}
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  variant="secondary"
                  disabled={
                    disabled ||
                    draft[branch].length >= MAX_ACTIONS ||
                    (branch === "elseActions" && draft.conditions.length === 0)
                  }
                  onClick={() =>
                    open({
                      kind: "action",
                      branch,
                      index: draft[branch].length,
                      value: { kind: "hide-all" },
                    })
                  }
                >
                  Add action
                </s-button>
              </s-stack>
            </s-stack>
          </BorderedCard>
        ))}

        <BorderedCard heading="Status">
          <s-stack gap="base">
            {checkout ? (
              <s-stack direction="inline" gap="small-200">
                <s-text>At checkout</s-text>
                <s-badge tone={checkout.tone}>{checkout.label}</s-badge>
              </s-stack>
            ) : null}
            <s-select
              label="Saved status"
              value={draft.active ? "active" : "inactive"}
              disabled={disabled}
              details={
                initial.appEnabled
                  ? "Active customizations run at checkout when you save."
                  : "ShipFlow is disabled. Active customizations are paused until you enable it in Settings."
              }
              onChange={(event) =>
                setDraft({ ...draft, active: fieldValue(event) === "active" })
              }
            >
              <s-option value="active">Active</s-option>
              <s-option value="inactive">Inactive</s-option>
            </s-select>
          </s-stack>
        </BorderedCard>
        {dirty && !valid.ok ? <s-paragraph>{valid.error}</s-paragraph> : null}
        <s-stack direction="inline" gap="small" justifyContent="end">
          <s-button href={deliveryPaths.list} variant="secondary">
            Back
          </s-button>
          <s-button
            variant="primary"
            loading={saving}
            disabled={!canSave || !ready}
            onClick={save}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
      <s-modal
        id="delivery-rule-entry"
        ref={modal as never}
        heading={entry?.kind === "condition" ? "Condition" : "Action"}
        onHide={() => setEntry(null)}
      >
        {entry ? (
          <s-stack gap="base">
            {entryError ? (
              <s-banner tone="critical" heading={entryError} />
            ) : null}
            {entry.kind === "condition" ? (
              <ConditionEditor
                key="condition"
                condition={entry.value}
                rule={draft}
                onChange={(value) => {
                  setEntryError(undefined);
                  setEntry({ ...entry, value });
                }}
              />
            ) : (
              <ActionEditor
                key="action"
                action={entry.value}
                shipping={draft.methods.includes("SHIPPING")}
                onChange={(value) => {
                  setEntryError(undefined);
                  setEntry({ ...entry, value });
                }}
              />
            )}
          </s-stack>
        ) : null}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor="delivery-rule-entry"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button slot="primary-action" variant="primary" onClick={applyEntry}>
          Apply
        </s-button>
      </s-modal>
    </s-page>
  );
}

function ConditionEditor({
  condition,
  rule,
  onChange,
}: {
  condition: Condition;
  rule: DeliveryRule;
  onChange: (value: Condition) => void;
}) {
  const field = fieldDetails(condition.field);
  const fields = (Object.keys(conditionFields) as Condition["field"][]).filter(
    (key) => fieldDetails(key).scopes.includes(rule.scope),
  );
  const categories = Array.from(
    new Set(fields.map((key) => fieldDetails(key).category)),
  );
  const choices = fields.filter(
    (key) => fieldDetails(key).category === field.category,
  );
  const options =
    field.input === "boolean"
      ? [
          ["true", "Yes"],
          ["false", "No"],
        ]
      : field.input === "purchase"
        ? [
            ["one-time", "One-time purchase"],
            ["subscription", "Subscription"],
          ]
        : null;
  const valueLabel =
    condition.field === "weight" ? `Value (${rule.weightUnit})` : "Value";
  const placeholder =
    field.input === "date"
      ? "YYYY-MM-DD"
      : field.input === "time"
        ? "HH:MM"
        : field.input === "collection"
          ? "Example: 123456789"
          : undefined;
  return (
    <s-stack gap="base">
      <s-select
        label="Category"
        value={field.category}
        onChange={(event) => {
          const category = fieldValue(event);
          const first = fields.find(
            (key) => fieldDetails(key).category === category,
          );
          if (first) onChange(blankCondition(first));
        }}
      >
        {categories.map((label) => (
          <s-option key={label} value={label}>
            {label}
          </s-option>
        ))}
      </s-select>
      <s-select
        label="Field"
        value={condition.field}
        onChange={(event) =>
          onChange(blankCondition(fieldValue(event) as Condition["field"]))
        }
      >
        {!choices.includes(condition.field) ? (
          <s-option value={condition.field}>
            {field.label} (different scope)
          </s-option>
        ) : null}
        {choices.map((key) => (
          <s-option key={key} value={key}>
            {fieldDetails(key).label}
          </s-option>
        ))}
      </s-select>
      <s-select
        label="Operator"
        key={`operator-${condition.field}`}
        value={condition.operator}
        onChange={(event) =>
          onChange({
            ...condition,
            operator: fieldValue(event) as Condition["operator"],
          })
        }
      >
        {field.operators.map((key) => (
          <s-option key={key} value={key}>
            {operators[key]}
          </s-option>
        ))}
      </s-select>
      {field.key ? (
        <s-text-field
          label={
            condition.field === "productQuantity" ? "SKU" : "Attribute key"
          }
          key={`${condition.field}-key`}
          required
          value={condition.key ?? ""}
          onInput={(event) =>
            onChange({ ...condition, key: fieldValue(event) })
          }
        />
      ) : null}
      {options ? (
        <s-select
          key={condition.field}
          label={valueLabel}
          value={condition.value}
          required
          onChange={(event) =>
            onChange({ ...condition, value: fieldValue(event) })
          }
        >
          {options.map(([key, label]) => (
            <s-option key={key} value={key}>
              {label}
            </s-option>
          ))}
        </s-select>
      ) : (
        <s-text-field
          key={condition.field}
          label={condition.operator === "between" ? "From" : valueLabel}
          placeholder={placeholder}
          required
          value={condition.value}
          onInput={(event) =>
            onChange({ ...condition, value: fieldValue(event) })
          }
        />
      )}
      {condition.operator === "between" ? (
        <s-text-field
          label="To"
          placeholder={placeholder}
          required
          value={condition.upper ?? ""}
          onInput={(event) =>
            onChange({ ...condition, upper: fieldValue(event) })
          }
        />
      ) : null}
    </s-stack>
  );
}

function ActionEditor({
  action,
  shipping,
  onChange,
}: {
  action: DeliveryAction;
  shipping: boolean;
  onChange: (value: DeliveryAction) => void;
}) {
  return (
    <s-stack gap="base">
      <s-select
        label="Action"
        value={action.kind}
        onChange={(event) => {
          const kind = fieldValue(event) as DeliveryAction["kind"];
          onChange({
            kind,
            ...(hasRateMatcher(kind) ? { operator: "equals" } : {}),
          });
        }}
      >
        {(Object.keys(actions) as DeliveryAction["kind"][])
          .filter(
            (key) =>
              shipping || !shippingTitleAction(key) || action.kind === key,
          )
          .map((key) => (
            <s-option key={key} value={key}>
              {actions[key]}
            </s-option>
          ))}
      </s-select>
      {action.kind === "show-all" ? (
        <s-paragraph>
          Clears hides from earlier actions in this customization. Shopify and
          other apps can still hide options.
        </s-paragraph>
      ) : null}
      {hasRateMatcher(action.kind) ? (
        <>
          <s-select
            label="Rate name operator"
            value={action.operator ?? "equals"}
            onChange={(event) =>
              onChange({
                ...action,
                operator: fieldValue(event) as DeliveryAction["operator"],
              })
            }
          >
            {nameOperators.map((key) => (
              <s-option key={key} value={key}>
                {operators[key]}
              </s-option>
            ))}
          </s-select>
          <s-text-field
            label="Rate name"
            required
            value={action.match ?? ""}
            onInput={(event) =>
              onChange({ ...action, match: fieldValue(event) })
            }
          />
        </>
      ) : null}
      {shippingTitleAction(action.kind) ? (
        <s-text-field
          label={
            action.kind === "message"
              ? "Message to append"
              : "New shipping title"
          }
          required
          value={action.text ?? ""}
          maxLength={100}
          onInput={(event) => onChange({ ...action, text: fieldValue(event) })}
        />
      ) : null}
      {action.kind === "reorder" ? (
        <s-number-field
          label="Position"
          details="0 is the first position."
          min={0}
          max={99}
          step={1}
          required
          value={action.position == null ? "" : String(action.position)}
          onInput={(event) => {
            const value = fieldValue(event);
            onChange({
              ...action,
              position: value === "" ? undefined : Number(value),
            });
          }}
        />
      ) : null}
    </s-stack>
  );
}

function EntryRow({
  label,
  index,
  count,
  disabled,
  onEdit,
  onRemove,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (step: number) => void;
}) {
  return (
    <s-box border="base base solid" borderRadius="base" padding="small">
      <s-stack
        direction="inline"
        gap="small"
        alignItems="center"
        justifyContent="space-between"
      >
        <s-text>{label}</s-text>
        <s-stack direction="inline" gap="small-200">
          {count > 1 ? (
            <>
              <s-button
                icon="chevron-up"
                accessibilityLabel={`Move up: ${label}`}
                disabled={disabled || index === 0}
                onClick={() => onMove(-1)}
              />
              <s-button
                icon="chevron-down"
                accessibilityLabel={`Move down: ${label}`}
                disabled={disabled || index === count - 1}
                onClick={() => onMove(1)}
              />
            </>
          ) : null}
          <s-button disabled={disabled} onClick={onEdit}>
            Edit
          </s-button>
          <s-button disabled={disabled} onClick={onRemove}>
            Remove
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function blankCondition(field: Condition["field"]): Condition {
  const { input, operators: fieldOperators } = fieldDetails(field);
  return {
    field,
    operator: fieldOperators[0],
    value:
      input === "boolean" ? "true" : input === "purchase" ? "one-time" : "",
  };
}

function conditionSummary(item: Condition) {
  return `${fieldDetails(item.field).label}${item.key ? ` (${item.key})` : ""} ${operators[item.operator].toLowerCase()} ${item.value}${item.upper ? ` and ${item.upper}` : ""}`;
}

function actionSummary(item: DeliveryAction) {
  return [actions[item.kind], item.match, item.text, item.position]
    .filter((value) => value != null)
    .join(" · ");
}

function fieldValue(event: Event) {
  return (event.currentTarget as HTMLInputElement).value;
}

function replaceOrAppend<T>(items: T[], index: number, item: T) {
  const next = [...items];
  next[index] = item;
  return next;
}

function remove<T>(items: T[], index: number) {
  return items.filter((_, current) => current !== index);
}

function move<T>(items: T[], index: number, step: number) {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(index + step, 0, item);
  return next;
}
