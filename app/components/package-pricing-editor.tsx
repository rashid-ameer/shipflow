import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { operatorLabels } from "../models/calculated-rates";
import { dimensionAxes } from "../models/product-dimensions";
import {
  emptyPackage,
  splitLabels,
  splitUnit,
  validatePacking,
  type PackageDraft,
  type PackagePricing,
} from "../models/package-pricing";
import {
  productFields,
  type ProductField,
  type RatePricing,
} from "../models/rate-pricing";
import { textOperators } from "../models/checkout-values";

export function PackagePricingEditor({
  pricing,
  packing,
  currency,
  weightUnit,
  dimensionUnit,
  change,
  carrier = false,
}: {
  pricing: RatePricing;
  packing: PackagePricing;
  currency: string;
  weightUnit: string;
  dimensionUnit: string;
  change: (patch: Partial<RatePricing>) => void;
  carrier?: boolean;
}) {
  const weight = packing.weightUnit ?? weightUnit;
  const unit = packing.dimensionUnit ?? dimensionUnit;
  const filter = pricing.filter;
  const byAttributes = packing.method === "attributes";
  function update(patch: Partial<PackagePricing>) {
    change({ packing: { ...packing, ...patch } });
  }
  const modal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [entry, setEntry] = useState<{
    index: number | null;
    box: PackageDraft;
  }>();
  const [error, setError] = useState("");
  const [previousPackages, setPreviousPackages] = useState<
    Partial<Record<PackagePricing["method"], PackageDraft[]>>
  >({});
  function open(index: number | null) {
    setEntry({
      index,
      box: index === null ? emptyPackage : packing.packages[index],
    });
    setError("");
    modal.current?.showOverlay();
  }
  function save() {
    if (!entry) return;
    const packages = [...packing.packages];
    packages[entry.index ?? packages.length] = carrier
      ? { ...entry.box, rate: "0" }
      : entry.box;
    try {
      const validated = validatePacking(
        { ...packing, packages },
        currency,
        pricing.amountType,
        weight,
        unit,
        carrier,
      );
      change({ packing: validated });
      modal.current?.hideOverlay();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Check the package details.",
      );
    }
  }
  function patch(field: keyof PackageDraft, value: string) {
    if (!entry) return;
    setEntry({ ...entry, box: { ...entry.box, [field]: value } });
    setError("");
  }
  const fields: {
    key: keyof PackageDraft;
    label: string;
    optional?: boolean;
  }[] = [
    ...(!carrier
      ? [
          {
            key: "rate" as const,
            label:
              pricing.amountType === "fixed"
                ? `Package rate (${currency})`
                : "Package rate (%)",
          },
        ]
      : []),
    ...(byAttributes
      ? [
          {
            key: "limit" as const,
            label: `Package max limit (${splitUnit(packing.split, currency, weight)})`,
          },
        ]
      : []),
    ...(!byAttributes || carrier
      ? [
          { key: "maxWeight" as const, label: `Maximum weight (${weight})` },
          {
            key: "emptyWeight" as const,
            label: `Empty weight (${weight})`,
            optional: true,
          },
          ...dimensionAxes.map((axis) => ({
            key: axis,
            label: `${axis[0].toUpperCase()}${axis.slice(1)} (${unit})`,
          })),
        ]
      : []),
  ];
  return (
    <s-stack gap="base">
      {!carrier ? (
        <s-select
          label="Packaging method"
          value={packing.method}
          onChange={(event) => {
            const method = event.currentTarget
              .value as PackagePricing["method"];
            if (method === packing.method) return;
            setPreviousPackages({
              ...previousPackages,
              [packing.method]: packing.packages,
            });
            update({ method, packages: previousPackages[method] ?? [] });
          }}
        >
          <s-option value="attributes">Pack by cart attributes</s-option>
          <s-option value="dimensions">AI based packaging</s-option>
        </s-select>
      ) : null}
      {byAttributes ? (
        <s-select
          label="Package splitting rule"
          value={packing.split}
          details={
            carrier
              ? "ShipFlow packs whole items using the cart attribute and weight limits."
              : "ShipFlow uses the smallest package that fits the remaining cart value. It uses the largest package when more than one is needed."
          }
          onChange={(event) =>
            update({
              split: event.currentTarget.value as PackagePricing["split"],
            })
          }
        >
          {Object.entries(splitLabels).map(([value, label]) => (
            <s-option key={value} value={value}>
              {String(label)}
            </s-option>
          ))}
        </s-select>
      ) : (
        <s-stack gap="small">
          <s-select
            label="Packing algorithm"
            value={packing.algorithm}
            onChange={(event) =>
              update({
                algorithm: event.currentTarget
                  .value as PackagePricing["algorithm"],
              })
            }
          >
            <s-option value="largest-package">Largest package first</s-option>
            <s-option value="largest-item">Largest item first</s-option>
          </s-select>
          <s-select
            label="Stack items"
            value={packing.stack}
            onChange={(event) =>
              update({
                stack: event.currentTarget.value as PackagePricing["stack"],
              })
            }
          >
            <s-option value="length">Lengthwise</s-option>
            <s-option value="width">Widthwise</s-option>
          </s-select>
          <s-checkbox
            label="Enable rotational packaging"
            checked={packing.rotate}
            details="Try all six orientations when fitting an item into a package."
            onChange={(event) =>
              update({ rotate: event.currentTarget.checked })
            }
          />
          <s-paragraph>
            Every eligible variant needs dimensions and weight to calculate this
            rate.
          </s-paragraph>
        </s-stack>
      )}
      {!carrier ? (
        <>
          <s-select
            label="Shipping rate type"
            value={pricing.amountType}
            onChange={(event) =>
              change({
                amountType: event.currentTarget
                  .value as RatePricing["amountType"],
              })
            }
          >
            <s-option value="fixed">Fixed amount</s-option>
            <s-option value="percent">Percentage of cart total</s-option>
          </s-select>
          <s-select
            label="Product filter"
            value={filter?.field ?? ""}
            onChange={(event) => {
              const field = event.currentTarget.value as ProductField;
              change({
                filter: field
                  ? {
                      field,
                      operator: filter?.operator ?? "eq",
                      value: filter?.value ?? "",
                    }
                  : undefined,
              });
            }}
          >
            <s-option value="">All products</s-option>
            {Object.entries(productFields).map(([value, label]) => (
              <s-option value={value} key={value}>
                {String(label)}
              </s-option>
            ))}
          </s-select>
          {filter ? (
            <s-stack gap="small">
              <s-select
                label="Filter operator"
                value={filter.operator}
                onChange={(event) =>
                  change({
                    filter: {
                      ...filter,
                      operator: event.currentTarget
                        .value as typeof filter.operator,
                    },
                  })
                }
              >
                {textOperators.map((operator) => (
                  <s-option key={operator} value={operator}>
                    {operatorLabels[operator]}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                required
                label="Filter values"
                details="Separate multiple values with commas."
                value={filter.value}
                onInput={(event) =>
                  change({
                    filter: { ...filter, value: event.currentTarget.value },
                  })
                }
              />
            </s-stack>
          ) : null}
        </>
      ) : null}
      <s-stack gap="base">
        <s-heading>Packages</s-heading>
        {packing.packages.length ? (
          packing.packages.map((box, index) => (
            <s-box
              key={box.name}
              border="base base solid"
              borderRadius="base"
              padding="base"
            >
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
                gap="small"
              >
                <s-stack gap="small">
                  <s-heading>{box.name}</s-heading>
                  <s-text>
                    {byAttributes
                      ? `Up to ${box.limit} ${splitUnit(packing.split, currency, weight)}`
                      : `${box.length} × ${box.width} × ${box.height} ${unit} · max ${box.maxWeight} ${weight}`}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" justifyContent="end" gap="small">
                  <s-button
                    accessibilityLabel={`Edit ${box.name}`}
                    onClick={() => open(index)}
                  >
                    Edit
                  </s-button>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    accessibilityLabel={`Remove ${box.name}`}
                    onClick={() =>
                      update({
                        packages: packing.packages.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ))
        ) : (
          <s-paragraph>Add at least one package.</s-paragraph>
        )}
        <s-stack direction="inline" justifyContent="end">
          <s-button
            disabled={packing.packages.length >= 30}
            onClick={() => open(null)}
          >
            Add package
          </s-button>
        </s-stack>
      </s-stack>
      {typeof document !== "undefined"
        ? createPortal(
            <s-modal
              ref={modal}
              heading={entry?.index != null ? "Edit package" : "Add package"}
              onHide={() => setEntry(undefined)}
            >
              {entry ? (
                <s-stack gap="base">
                  {error ? <s-banner tone="critical">{error}</s-banner> : null}
                  <s-text-field
                    required
                    label="Package name"
                    maxLength={120}
                    value={entry.box.name}
                    onInput={(event) =>
                      patch("name", event.currentTarget.value)
                    }
                  />
                  <s-grid
                    gap="small"
                    gridTemplateColumns="repeat(auto-fit,minmax(min(100%,150px),1fr))"
                  >
                    {fields.map(({ key, label, optional }) => (
                      <s-number-field
                        key={key}
                        label={label}
                        required={!optional}
                        min={0}
                        inputMode="decimal"
                        value={entry.box[key]}
                        onInput={(event) =>
                          patch(key, event.currentTarget.value)
                        }
                      />
                    ))}
                  </s-grid>
                </s-stack>
              ) : null}
              <s-button
                slot="secondary-actions"
                onClick={() => modal.current?.hideOverlay()}
              >
                Cancel
              </s-button>
              <s-button
                slot="primary-action"
                variant="primary"
                disabled={!entry}
                onClick={save}
              >
                {entry?.index != null ? "Save package" : "Add package"}
              </s-button>
            </s-modal>,
            document.body,
          )
        : null}
    </s-stack>
  );
}
