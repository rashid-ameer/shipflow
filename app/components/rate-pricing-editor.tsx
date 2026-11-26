import { useState } from "react";
import { emptyPacking } from "../models/package-pricing";
import { PackagePricingEditor } from "./package-pricing-editor";
import { UpsConnectionPanel, type UpsConnection } from "./carrier-connection";
import {
  carriers,
  newLiveCarrierRate,
  type LiveCarrierRate,
} from "../models/live-carrier";
import { operatorLabels, type RateDraft } from "../models/calculated-rates";
import { textOperators } from "../models/checkout-values";
import {
  type Modifier,
  type Tier,
  type RatePricing,
  type ProductField,
  pricingBases,
  productFields,
} from "../models/rate-pricing";
import {
  ROUNDING_METHODS,
  type RoundingMethod,
} from "../models/shipping-settings";

const defaultPricing: RatePricing = {
  mode: "flat",
  criteria: "cart",
  basis: "total",
  amountType: "fixed",
};
const defaultModifier: Modifier = {
  kind: "fixed",
  basis: "shipping",
  value: "",
};
const defaultIncrement = {
  base: "",
  rate: "",
  step: "1",
  skip: "0",
  rounding: "none" as const,
};
const roundingOptions: Record<RoundingMethod, string> = {
  none: "None",
  "nearest-half": "Nearest half unit",
  "nearest-one": "Nearest whole unit",
  ceil: "Round up",
  floor: "Round down",
};

export function rateSummary(rate: RateDraft, currency: string) {
  if (rate.liveCarrier)
    return `${carriers[rate.liveCarrier.carrier]} live carrier`;
  const pricing = rate.pricing;
  if (!pricing || pricing.mode === "flat") return `${currency} ${rate.price}`;
  if (pricing.mode === "package")
    return `${pricing.packing?.packages.length ?? 0} packages`;
  const subject = pricing.criteria === "product" ? "Product" : "Cart";
  const basis = pricingBases[pricing.basis].toLowerCase();
  return pricing.mode === "tiered"
    ? `${subject} ${basis} · ${pricing.tiers?.length ?? 0} ${pricing.tiers?.length === 1 ? "tier" : "tiers"}`
    : `${subject} ${basis} · Incremental`;
}

function Field({
  label,
  value,
  change,
  details,
  required,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  details?: string;
  required?: boolean;
}) {
  return (
    <s-text-field
      label={label}
      value={value}
      details={details}
      required={required}
      onInput={(event) => change(event.currentTarget.value)}
    />
  );
}

export function RatePricingEditor({
  value,
  currency,
  weightUnit,
  dimensionUnit,
  connection,
  change,
}: {
  value: RateDraft;
  currency: string;
  weightUnit: string;
  dimensionUnit: string;
  connection: UpsConnection;
  change: (value: RateDraft) => void;
}) {
  const pricing = value.pricing ?? defaultPricing;
  const live = value.liveCarrier;
  const update = (patch: Partial<RatePricing>) =>
    change({ ...value, pricing: { ...pricing, ...patch } });
  const unit =
    pricing.basis === "quantity"
      ? "items"
      : pricing.basis === "weight"
        ? (pricing.weightUnit ?? weightUnit)
        : pricing.basis === "volume"
          ? "cm³"
          : pricing.basis === "volumetric"
            ? "kg"
            : currency;
  const amountUnit = pricing.amountType === "percent" ? "%" : currency;
  const tiers = pricing.tiers ?? [];
  const increment = pricing.increment ?? defaultIncrement;
  const filter = pricing.filter;
  function updateTier(index: number, patch: Partial<Tier>) {
    update({
      tiers: tiers.map((tier, i) =>
        i === index ? { ...tier, ...patch } : tier,
      ),
    });
  }
  function moveTier(index: number, offset: number) {
    const ordered = [...tiers];
    [ordered[index], ordered[index + offset]] = [
      ordered[index + offset],
      ordered[index],
    ];
    update({ tiers: ordered });
  }
  return (
    <s-stack gap="base">
      <s-select
        label="Rate type"
        value={live ? "live" : "fixed"}
        onChange={(event) =>
          change({
            ...value,
            liveCarrier:
              event.currentTarget.value === "live"
                ? newLiveCarrierRate
                : undefined,
          })
        }
      >
        <s-option value="fixed">Fixed rate</s-option>
        <s-option value="live">Live carriers</s-option>
      </s-select>
      <s-text-field
        label="Shipping rate name"
        required
        maxLength={120}
        value={value.name}
        details={
          live
            ? "Internal name. Customers see the carrier service name."
            : "Customers see this name at checkout."
        }
        onInput={(event) =>
          change({ ...value, name: event.currentTarget.value })
        }
      />
      {live ? (
        <LiveCarrierFields
          live={live}
          connection={connection}
          currency={currency}
          weightUnit={weightUnit}
          dimensionUnit={dimensionUnit}
          change={(liveCarrier) => change({ ...value, liveCarrier })}
        />
      ) : (
        <>
          <s-text-area
            label="Checkout description"
            value={value.description}
            maxLength={250}
            onInput={(event) =>
              change({ ...value, description: event.currentTarget.value })
            }
          />
          <s-select
            label="Pricing method"
            value={pricing.mode}
            onChange={(event) => {
              const mode = event.currentTarget.value as RatePricing["mode"];
              update({
                mode,
                ...(mode === "tiered" && !tiers.length
                  ? { tiers: [{ min: "0", max: "~", value: "" }] }
                  : {}),
              });
            }}
          >
            <s-option value="flat">Flat rate</s-option>
            <s-option value="tiered">Tiered rates</s-option>
            <s-option value="incremental">Base rate with increment</s-option>
            <s-option value="package">Based on package</s-option>
          </s-select>
          {pricing.mode === "package" ? (
            <PackagePricingEditor
              pricing={pricing}
              packing={pricing.packing ?? emptyPacking}
              currency={currency}
              weightUnit={weightUnit}
              dimensionUnit={dimensionUnit}
              change={update}
            />
          ) : pricing.mode === "flat" ? (
            <Field
              required
              label={`Fixed price (${currency})`}
              value={value.price}
              change={(price) => change({ ...value, price })}
            />
          ) : (
            <>
              <s-grid
                gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 150px), 1fr))"
                gap="small"
              >
                <s-select
                  label="Calculate for"
                  value={pricing.criteria}
                  onChange={(event) => {
                    const criteria = event.currentTarget
                      .value as RatePricing["criteria"];
                    update({
                      criteria,
                      basis:
                        criteria === "cart" && pricing.basis === "price"
                          ? "total"
                          : pricing.basis,
                    });
                  }}
                >
                  <s-option value="cart">Cart</s-option>
                  <s-option value="product">Products</s-option>
                </s-select>
                <s-select
                  label="Pricing basis"
                  value={pricing.basis}
                  onChange={(event) =>
                    update({
                      basis: event.currentTarget.value as RatePricing["basis"],
                    })
                  }
                >
                  {(Object.keys(pricingBases) as RatePricing["basis"][])
                    .filter(
                      (key) =>
                        key !== "price" || pricing.criteria === "product",
                    )
                    .map((key) => (
                      <s-option key={key} value={key}>
                        {pricingBases[key]}
                      </s-option>
                    ))}
                </s-select>
                <s-select
                  label="Rate type"
                  value={pricing.amountType}
                  onChange={(event) =>
                    update({
                      amountType: event.currentTarget
                        .value as RatePricing["amountType"],
                    })
                  }
                >
                  <s-option value="fixed">Fixed amount</s-option>
                  <s-option value="percent">
                    Percentage of merchandise total
                  </s-option>
                </s-select>
              </s-grid>
              {pricing.criteria === "product" ? (
                <s-stack gap="small">
                  <s-select
                    label="Product filter"
                    value={filter?.field ?? ""}
                    onChange={(event) => {
                      const field = event.currentTarget.value as
                        ProductField | "";
                      update({
                        filter: field
                          ? {
                              field,
                              operator: filter?.operator ?? "eq",
                              value: filter?.value ?? "",
                            }
                          : undefined,
                        ...(field
                          ? {}
                          : {
                              aggregate:
                                pricing.aggregate === "group"
                                  ? "line"
                                  : pricing.aggregate,
                            }),
                      });
                    }}
                  >
                    <s-option value="">All products</s-option>
                    {(Object.keys(productFields) as ProductField[]).map(
                      (key) => (
                        <s-option key={key} value={key}>
                          {productFields[key]}
                        </s-option>
                      ),
                    )}
                  </s-select>
                  {filter ? (
                    <s-grid
                      gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 160px), 1fr))"
                      gap="small"
                    >
                      <s-select
                        label="Filter operator"
                        value={filter.operator}
                        onChange={(event) =>
                          update({
                            filter: {
                              ...filter,
                              operator: event.currentTarget
                                .value as typeof filter.operator,
                            },
                          })
                        }
                      >
                        {textOperators.map((key) => (
                          <s-option key={key} value={key}>
                            {operatorLabels[key]}
                          </s-option>
                        ))}
                      </s-select>
                      <Field
                        required
                        label="Filter values"
                        value={filter.value}
                        details="Separate values with commas."
                        change={(value) =>
                          update({ filter: { ...filter, value } })
                        }
                      />
                    </s-grid>
                  ) : null}
                  <s-select
                    label="Calculate rates"
                    value={pricing.aggregate ?? "line"}
                    onChange={(event) =>
                      update({
                        aggregate: event.currentTarget
                          .value as RatePricing["aggregate"],
                      })
                    }
                  >
                    <s-option value="line">
                      For each matching product line
                    </s-option>
                    <s-option value="combine">
                      Combine matching products
                    </s-option>
                    {filter ? (
                      <s-option value="group">
                        Group by each filter value
                      </s-option>
                    ) : null}
                  </s-select>
                  {["weight", "volume", "volumetric"].includes(
                    pricing.basis,
                  ) ? (
                    <s-checkbox
                      label="Use individual unit weight"
                      checked={pricing.individual ?? false}
                      onChange={(event) =>
                        update({ individual: event.currentTarget.checked })
                      }
                    />
                  ) : null}
                </s-stack>
              ) : null}
              {pricing.mode === "tiered" ? (
                <s-stack gap="small">
                  <s-heading>Tiers</s-heading>
                  <s-paragraph>
                    The first matching tier wins. Both boundaries are included.
                  </s-paragraph>
                  {tiers.map((tier, index) => (
                    <s-box
                      key={index}
                      border="base"
                      padding="base"
                      borderRadius="base"
                    >
                      <s-stack gap="small">
                        <s-text type="strong">Tier {index + 1}</s-text>
                        <s-grid
                          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 140px), 1fr))"
                          gap="small"
                        >
                          <Field
                            required
                            label={`Minimum (${unit})`}
                            value={tier.min}
                            change={(min) => updateTier(index, { min })}
                          />
                          <Field
                            label={`Maximum (${unit})`}
                            value={tier.max}
                            details="Use ~ for unlimited."
                            change={(max) => updateTier(index, { max })}
                          />
                          <Field
                            required
                            label={`Rate (${amountUnit})`}
                            value={tier.value}
                            change={(value) => updateTier(index, { value })}
                          />
                        </s-grid>
                        {tier.min && tier.value ? (
                          <s-text>
                            {tier.max && tier.max !== "~"
                              ? `${tier.min}–${tier.max}`
                              : `${tier.min}+`}{" "}
                            {unit} · {tier.value} {amountUnit}
                          </s-text>
                        ) : null}
                        <s-stack
                          direction="inline"
                          gap="small"
                          justifyContent="end"
                        >
                          <s-button
                            variant="tertiary"
                            disabled={index === 0}
                            onClick={() => moveTier(index, -1)}
                          >
                            Move up
                          </s-button>
                          <s-button
                            variant="tertiary"
                            disabled={index === tiers.length - 1}
                            onClick={() => moveTier(index, 1)}
                          >
                            Move down
                          </s-button>
                          <s-button
                            variant="tertiary"
                            onClick={() =>
                              update({
                                tiers: tiers.filter((_, i) => i !== index),
                              })
                            }
                          >
                            Remove tier
                          </s-button>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  ))}
                  <s-stack direction="inline" justifyContent="end">
                    <s-button
                      disabled={tiers.length >= 30}
                      onClick={() =>
                        update({
                          tiers: [...tiers, { min: "", max: "~", value: "" }],
                        })
                      }
                    >
                      Add tier
                    </s-button>
                  </s-stack>
                </s-stack>
              ) : (
                <s-stack gap="small">
                  <s-heading>Incremental price</s-heading>
                  <s-grid
                    gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 150px), 1fr))"
                    gap="small"
                  >
                    <Field
                      required
                      label={`Base rate (${amountUnit})`}
                      value={increment.base}
                      change={(base) =>
                        update({ increment: { ...increment, base } })
                      }
                    />
                    <Field
                      required
                      label={`Incremental rate (${amountUnit})`}
                      value={increment.rate}
                      change={(rate) =>
                        update({ increment: { ...increment, rate } })
                      }
                    />
                    <Field
                      required
                      label={`Step size (${unit})`}
                      value={increment.step}
                      change={(step) =>
                        update({ increment: { ...increment, step } })
                      }
                    />
                    <Field
                      label={`Skip first (${unit})`}
                      value={increment.skip}
                      change={(skip) =>
                        update({ increment: { ...increment, skip } })
                      }
                    />
                  </s-grid>
                  <s-select
                    label="Incremental amount rounding"
                    value={increment.rounding}
                    onChange={(event) =>
                      update({
                        increment: {
                          ...increment,
                          rounding: event.currentTarget.value as RoundingMethod,
                        },
                      })
                    }
                  >
                    {ROUNDING_METHODS.map((key) => (
                      <s-option key={key} value={key}>
                        {roundingOptions[key]}
                      </s-option>
                    ))}
                  </s-select>
                </s-stack>
              )}
            </>
          )}
        </>
      )}
      <s-stack gap="base">
        <s-heading>Price adjustments</s-heading>
        <ModifierFields
          title="Discount"
          value={pricing.discount}
          currency={currency}
          change={(discount) => update({ discount })}
        />
        {pricing.discount ? (
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 170px), 1fr))"
            gap="small"
          >
            <Field
              label={`Discount minimum (${currency})`}
              value={pricing.discount.minimum ?? ""}
              change={(minimum) =>
                update({
                  discount: {
                    ...pricing.discount!,
                    minimum,
                    minimumBasis: pricing.discount?.minimumBasis ?? "shipping",
                  },
                })
              }
            />
            <s-select
              label="Discount minimum based on"
              value={pricing.discount.minimumBasis ?? "shipping"}
              onChange={(event) =>
                update({
                  discount: {
                    ...pricing.discount!,
                    minimumBasis: event.currentTarget
                      .value as Modifier["basis"],
                  },
                })
              }
            >
              <s-option value="shipping">Calculated shipping rate</s-option>
              <s-option value="cart">Merchandise total</s-option>
            </s-select>
          </s-grid>
        ) : null}
        <ModifierFields
          title="Handling fee"
          value={pricing.handling}
          currency={currency}
          change={(handling) => update({ handling })}
        />
        <ModifierFields
          title="Insurance fee"
          value={pricing.insurance}
          currency={currency}
          change={(insurance) => update({ insurance })}
        />
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 170px), 1fr))"
          gap="small"
        >
          <Field
            label={`Minimum shipping rate (${currency})`}
            value={pricing.minimum ?? ""}
            change={(minimum) => update({ minimum })}
          />
          <Field
            label={`Maximum shipping rate (${currency})`}
            value={pricing.maximum ?? ""}
            change={(maximum) => update({ maximum })}
          />
        </s-grid>
      </s-stack>
      <s-select
        label="Rate status"
        value={value.active === false ? "inactive" : "active"}
        onChange={(event) =>
          change({ ...value, active: event.currentTarget.value === "active" })
        }
      >
        <s-option value="active">Active</s-option>
        <s-option value="inactive">Inactive</s-option>
      </s-select>
      <s-text-field
        label="Shipping tags"
        value={value.tags ?? ""}
        details="Separate tags with commas."
        maxLength={1850}
        onInput={(event) =>
          change({ ...value, tags: event.currentTarget.value })
        }
      />
      <s-text-area
        label="Internal notes"
        value={value.notes ?? ""}
        maxLength={1000}
        onInput={(event) =>
          change({ ...value, notes: event.currentTarget.value })
        }
      />
    </s-stack>
  );
}

function LiveCarrierFields({
  live,
  connection,
  currency,
  weightUnit,
  dimensionUnit,
  change,
}: {
  live: LiveCarrierRate;
  connection: UpsConnection;
  currency: string;
  weightUnit: string;
  dimensionUnit: string;
  change: (rate: LiveCarrierRate) => void;
}) {
  const update = (patch: Partial<LiveCarrierRate>) =>
    change({ ...live, ...patch });
  const [showConnection, setShowConnection] = useState(false);
  const fallback = live.fallback;
  return (
    <s-stack gap="base">
      <s-select
        label="Carrier"
        value={live.carrier}
        onChange={(event) =>
          update({
            carrier: event.currentTarget.value as LiveCarrierRate["carrier"],
            domestic: [],
            international: [],
          })
        }
      >
        {Object.entries(carriers).map(([id, label]) => (
          <s-option key={id} value={id} disabled={id !== "ups"}>
            {label}
            {id !== "ups" ? " (unavailable)" : ""}
          </s-option>
        ))}
      </s-select>
      {live.carrier === "ups" ? (
        <>
          <s-button onClick={() => setShowConnection(!showConnection)}>
            {showConnection
              ? "Hide UPS connection"
              : connection
                ? "Manage or sync UPS"
                : "Connect UPS"}
          </s-button>
          {showConnection ? (
            <UpsConnectionPanel connection={connection} />
          ) : null}
        </>
      ) : null}
      <s-select
        label="Shipping location"
        value={live.origin.type}
        onChange={(event) =>
          update({
            origin: {
              ...live.origin,
              type: event.currentTarget
                .value as LiveCarrierRate["origin"]["type"],
            },
          })
        }
      >
        <s-option value="shopify">Use Shopify fulfillment location</s-option>
        <s-option value="custom">Specify different location</s-option>
      </s-select>
      {live.origin.type === "custom" ? (
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(135px, 1fr))"
          gap="small"
        >
          <Field
            label="Origin country code"
            required
            value={live.origin.country}
            change={(country) =>
              update({ origin: { ...live.origin, country } })
            }
          />
          <Field
            label="Origin postal code"
            required
            value={live.origin.postalCode}
            change={(postalCode) =>
              update({ origin: { ...live.origin, postalCode } })
            }
          />
          <Field
            label="Origin state or province code"
            value={live.origin.province ?? ""}
            change={(province) =>
              update({ origin: { ...live.origin, province } })
            }
          />
        </s-grid>
      ) : null}
      {(["domestic", "international"] as const).map((lane) => {
        const label = lane === "domestic" ? "Domestic" : "International";
        const selection =
          lane === "domestic"
            ? live.selection
            : (live.internationalSelection ?? live.selection);
        const services = new Map(
          (connection?.services[lane] ?? []).map((service) => [
            service.code,
            service.name,
          ]),
        );
        for (const code of live[lane])
          if (!services.has(code)) services.set(code, `Service ${code}`);
        return (
          <s-stack key={lane} gap="small">
            <s-select
              label={`${label} service selection`}
              value={selection}
              onChange={(event) => {
                const selected = event.currentTarget
                  .value as LiveCarrierRate["selection"];
                update(
                  lane === "domestic"
                    ? {
                        selection: selected,
                        internationalSelection:
                          live.internationalSelection ?? live.selection,
                      }
                    : { internationalSelection: selected },
                );
              }}
            >
              <s-option value="all">Show all services</s-option>
              <s-option value="highest">
                Show service with highest rate
              </s-option>
              <s-option value="lowest">Show service with lowest rate</s-option>
            </s-select>
            <s-paragraph>
              {services.size
                ? "Select services to restrict quotes. Leave all unchecked to allow any service."
                : `Test a ${lane} route to list services. All returned services are eligible until you select specific services.`}
            </s-paragraph>
            {[...services].map(([code, name]) => (
              <s-checkbox
                key={code}
                label={name}
                checked={live[lane].includes(code)}
                onChange={(event) =>
                  update({
                    [lane]: event.currentTarget.checked
                      ? [...live[lane], code]
                      : live[lane].filter((item) => item !== code),
                  })
                }
              />
            ))}
          </s-stack>
        );
      })}
      <s-select
        label="Packaging method"
        value={live.packaging}
        onChange={(event) => {
          const packaging = event.currentTarget
            .value as LiveCarrierRate["packaging"];
          update({
            packaging,
            packing:
              packaging === "individual"
                ? undefined
                : { ...emptyPacking, method: packaging },
          });
        }}
      >
        <s-option value="attributes">Pack by cart attributes</s-option>
        <s-option value="individual">Pack each product separately</s-option>
        <s-option value="dimensions">AI based packaging</s-option>
      </s-select>
      {live.packaging === "individual" ? (
        <s-paragraph>
          Items without dimensions or weight are omitted from the carrier quote.
        </s-paragraph>
      ) : (
        <PackagePricingEditor
          key={live.packaging}
          carrier
          pricing={defaultPricing}
          packing={live.packing ?? { ...emptyPacking, method: live.packaging }}
          currency={currency}
          weightUnit={weightUnit}
          dimensionUnit={dimensionUnit}
          change={({ packing }) => update({ packing })}
        />
      )}
      <Field
        label={`Override carrier price (${currency})`}
        value={live.override ?? ""}
        change={(override) => update({ override })}
      />
      <s-checkbox
        label="Use a fallback when the carrier quote fails"
        checked={Boolean(fallback)}
        onChange={(event) =>
          update({
            fallback: event.currentTarget.checked
              ? { name: "", description: "", kind: "fixed", value: "" }
              : undefined,
          })
        }
      />
      {fallback ? (
        <>
          <Field
            label="Fallback name"
            required
            value={fallback.name}
            change={(name) => update({ fallback: { ...fallback, name } })}
          />
          <Field
            label="Fallback description"
            value={fallback.description}
            change={(description) =>
              update({ fallback: { ...fallback, description } })
            }
          />
          <s-select
            label="Fallback price type"
            value={fallback.kind}
            onChange={(event) =>
              update({
                fallback: {
                  ...fallback,
                  kind: event.currentTarget.value as typeof fallback.kind,
                },
              })
            }
          >
            <s-option value="fixed">Fixed amount</s-option>
            <s-option value="percent">Percentage of cart total</s-option>
          </s-select>
          <Field
            label={`Fallback amount (${fallback.kind === "fixed" ? currency : "%"})`}
            required
            value={fallback.value}
            change={(value) => update({ fallback: { ...fallback, value } })}
          />
        </>
      ) : null}
    </s-stack>
  );
}

function ModifierFields<T extends Modifier>({
  title,
  value,
  currency,
  change,
}: {
  title: string;
  value?: T;
  currency: string;
  change: (value?: T) => void;
}) {
  return (
    <s-stack gap="small">
      <s-checkbox
        label={`Apply ${title.toLowerCase()}`}
        checked={Boolean(value)}
        onChange={(event) =>
          change(
            event.currentTarget.checked
              ? ({ ...defaultModifier } as T)
              : undefined,
          )
        }
      />
      {value ? (
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 150px), 1fr))"
          gap="small"
        >
          <s-select
            label={`${title} type`}
            value={value.kind}
            onChange={(event) =>
              change({
                ...value,
                kind: event.currentTarget.value as Modifier["kind"],
              })
            }
          >
            <s-option value="fixed">Fixed amount</s-option>
            <s-option value="percent">Percentage</s-option>
          </s-select>
          <Field
            required
            label={`${title} (${value.kind === "fixed" ? currency : "%"})`}
            value={value.value}
            change={(amount) => change({ ...value, value: amount })}
          />
          {value.kind === "percent" ? (
            <s-select
              label={`${title} based on`}
              value={value.basis}
              onChange={(event) =>
                change({
                  ...value,
                  basis: event.currentTarget.value as Modifier["basis"],
                })
              }
            >
              <s-option value="shipping">Shipping rate</s-option>
              <s-option value="cart">Merchandise total</s-option>
            </s-select>
          ) : null}
        </s-grid>
      ) : null}
    </s-stack>
  );
}
