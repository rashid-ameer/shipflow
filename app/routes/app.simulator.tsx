import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  data,
  useFetcher,
  useLoaderData,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import { combinedPaths } from "../models/combined-rates";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop-settings.server";
import {
  countries,
  normalizeLocale,
  parseMoney,
  rateIdPattern,
  ratesPaths,
  validateCoverage,
  type CarrierCart,
} from "../models/calculated-rates";
import {
  loadRatesContext,
  RateFormError,
} from "../models/calculated-rates.server";
import { cartSnapshot, diagnosticsPaths } from "../models/checkout-history";
import {
  findCustomers,
  getSimulatorCustomer,
  getSimulatorLines,
  getSimulatorLocations,
  simulatorQuantities,
} from "../models/checkout-catalog.server";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../models/checkout-pricing.server";
import { requireRatesStore } from "../models/rates-access.server";
import {
  CheckoutCartDetails,
  CheckoutPricingResults,
} from "../components/checkout-pricing-results";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.mode !== "CCS_RATES" || store.onboardingStep !== "COMPLETE")
    return { ccs: false as const };
  const [context, locations, scenarios, combinedRules] = await Promise.all([
    loadRatesContext(admin.graphql, store),
    getSimulatorLocations(admin.graphql).catch(() => null),
    prisma.rateScenario.findMany({
      where: { storeId: store.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    prisma.combinedRateRule.findMany({
      where: { storeId: store.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, active: true },
    }),
  ]);
  return {
    ccs: true as const,
    context,
    locations,
    scenarios,
    combinedRules,
    testMode: store.testMode,
    useDiscountedTotal: store.settings.discountedCartTotal,
    appEnabled: store.appEnabled,
    connected: Boolean(store.carrierServiceId && store.ccsStatus === "ENABLED"),
    customerAccess:
      session.scope?.split(",").includes("read_customers") ?? false,
  };
}

function formText(form: FormData, key: string, limit = 120) {
  const input = form.get(key);
  if (typeof input !== "string") return "";
  const text = input.trim();
  if (text.length > limit)
    throw new RateFormError("Check the length of your checkout inputs.");
  return text;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, store } = await requireRatesStore(request, true);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "customers") {
    try {
      const term = formText(form, "query", 80);
      if (term.length < 2) return { kind: "customers" as const, customers: [] };
      return {
        kind: "customers" as const,
        customers: await findCustomers(admin.graphql, term),
      };
    } catch {
      return data(
        {
          kind: "error" as const,
          message:
            "Shopify could not search customers. Check customer access or simulate as a guest.",
        },
        { status: 422 },
      );
    }
  }
  if (intent !== "run")
    return data(
      { kind: "error" as const, message: "Unknown action." },
      { status: 400 },
    );
  try {
    const pricingStore = await getPricingStore(store.id);
    if (!pricingStore)
      throw new RateFormError("Store settings could not be loaded.");
    const quantities = simulatorQuantities(
      JSON.parse(formText(form, "items", 8192) || "[]"),
    );
    const country = formText(form, "country", 2).toUpperCase();
    const province = formText(form, "province", 8).toUpperCase();
    if (
      !countries.some((entry) => entry.code === country) ||
      (province && !/^[A-Z0-9-]{1,8}$/.test(province))
    )
      throw new RateFormError(
        "Choose a destination country and enter a valid province or state code.",
      );
    const destination = validateCoverage([
      { country, provinces: province ? [province] : [] },
    ])[0];
    const language = formText(form, "language", 30);
    const locale = normalizeLocale(language);
    if (language && !locale)
      throw new RateFormError(
        "Enter a checkout language code such as en or en-CA.",
      );
    const selected = form.getAll("scenario");
    if (
      selected.some(
        (id) => typeof id !== "string" || !rateIdPattern.test(id),
      ) ||
      new Set(selected).size !== selected.length
    )
      throw new RateFormError("Choose valid shipping scenarios.");
    const scenarioIds = selected.length ? (selected as string[]) : undefined;
    const rules = form.getAll("combined");
    if (
      !rules.every(
        (id): id is string => typeof id === "string" && rateIdPattern.test(id),
      ) ||
      new Set(rules).size !== rules.length
    )
      throw new RateFormError("Choose valid combined rates.");
    const combinedIds =
      form.get("includeCombined") === "no"
        ? []
        : rules.length
          ? rules
          : undefined;
    const locationId = formText(form, "location");
    if (locationId && !/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(locationId))
      throw new RateFormError("Select a Shopify fulfillment location.");
    const customerId = formText(form, "customer");
    const [context, locations, customer] = await Promise.all([
      loadRatesContext(admin.graphql, store),
      locationId ? getSimulatorLocations(admin.graphql) : [],
      customerId ? getSimulatorCustomer(admin.graphql, customerId) : null,
    ]);
    if (!context)
      throw new RateFormError(
        "Shopify could not load the store currency. Try again.",
      );
    const location = locations.find(({ id }) => id === locationId);
    if (locationId && !location)
      throw new RateFormError(
        "That fulfillment location is no longer available.",
      );
    const { lines, subtotal } = await getSimulatorLines(
      admin.graphql,
      quantities,
      context.currency,
    );
    const discount = formText(form, "discount", 24);
    const discountAmount = discount
      ? parseMoney(discount, context.currency)
      : 0;
    const cart: CarrierCart = {
      currency: context.currency,
      lines,
      subtotal,
      discountedSubtotal: Math.max(0, subtotal - discountAmount),
      destination: {
        country: destination.country,
        province: destination.provinces[0] ?? null,
      },
      origin: location
        ? { country: location.country, province: location.province }
        : context.country
          ? { country: context.country, province: null }
          : undefined,
      postalCode: formText(form, "postal", 24) || undefined,
      city: formText(form, "city", 100) || undefined,
      customer: {
        address: formText(form, "street", 200) || undefined,
        company: formText(form, "company", 120) || undefined,
      },
      customerId: customer?.id.split("/").at(-1),
      locale,
      firstName:
        pricingStore.testMode && form.get("testIdentity") === "yes"
          ? "shipflow"
          : (customer?.firstName ?? null),
      customerTags: customer?.tags,
    };
    const result = await evaluateStoreCart(pricingStore, cart, {
      simulation: true,
      scenarioIds,
      combinedIds,
      getGraphql: async () => admin.graphql,
    });
    return { kind: "result" as const, result, cart: cartSnapshot(cart) };
  } catch (error) {
    return data(
      {
        kind: "error" as const,
        message:
          error instanceof RateFormError
            ? error.message
            : "Simulation could not run. Check the inputs and try again.",
      },
      { status: 422 },
    );
  }
}

type SimulatorContext = Extract<
  Awaited<ReturnType<typeof loader>>,
  { ccs: true }
>;
type CartItem = { id: string; name: string; quantity: string };

export default function CheckoutSimulatorPage() {
  const initial = useLoaderData<typeof loader>();
  return (
    <s-page heading="Checkout simulator">
      {!initial.ccs ? (
        <s-banner tone="info" heading="Test Delivery Customization in checkout">
          <s-paragraph>
            Open your online store and go through checkout to see your delivery
            customization rules in action.
          </s-paragraph>
        </s-banner>
      ) : (
        <Simulator initial={initial} />
      )}
    </s-page>
  );
}

function Simulator({ initial }: { initial: SimulatorContext }) {
  const shopify = useAppBridge();
  const run = useFetcher<typeof action>();
  const customers = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [items, setItems] = useState<CartItem[]>([]);
  const [values, setValues] = useState({
    country: initial.context?.country ?? "",
    province: "",
    city: "",
    postal: "",
    street: "",
    company: "",
    discount: "",
    location: "",
    language: "",
    customer: "",
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedCombined, setSelectedCombined] = useState<string[]>([]);
  const [includeCombined, setIncludeCombined] = useState(true);
  const [testIdentity, setTestIdentity] = useState(initial.testMode);
  const [customerAccess, setCustomerAccess] = useState(initial.customerAccess);
  const [query, setQuery] = useState("");
  const [lastSearch, setLastSearch] = useState("");
  const [chosenCustomer, setChosenCustomer] = useState<{
    id: string;
    name: string;
  }>();
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [lastInput, setLastInput] = useState("");
  const serializedItems = JSON.stringify(
    items.map(({ id, quantity }) => ({ id, quantity })),
  );
  const inputKey = JSON.stringify([
    values,
    serializedItems,
    selected,
    selectedCombined,
    includeCombined,
    testIdentity,
  ]);
  const busy = run.state !== "idle";
  const searching = customers.state !== "idle";
  const update = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const valid = Boolean(
    initial.context &&
    values.country &&
    items.length &&
    items.every(({ quantity }) => /^[1-9]\d{0,3}$/.test(quantity)),
  );
  const result =
    !busy && inputKey === lastInput && run.data?.kind === "result"
      ? run.data
      : null;
  const foundCustomers =
    lastSearch === query.trim() && customers.data?.kind === "customers"
      ? customers.data.customers
      : [];
  const customerOptions =
    chosenCustomer && !foundCustomers.some(({ id }) => id === chosenCustomer.id)
      ? [chosenCustomer, ...foundCustomers]
      : foundCustomers;

  async function addItems(byCollection: boolean) {
    setError("");
    setPicking(true);
    try {
      let picked: { id: string; name: string }[] | undefined;
      if (byCollection) {
        const [collection] =
          (await shopify.resourcePicker({
            type: "collection",
            action: "select",
          })) ?? [];
        if (!collection) return;
        const collectionId = collection.id.replace(
          /^gid:\/\/shopify\/Collection\//,
          "",
        );
        if (!collectionId || !/^\d+$/.test(collectionId)) return;
        const products = await shopify.resourcePicker({
          type: "product",
          multiple: 50,
          filter: { variants: true, query: `collection_id:${collectionId}` },
        });
        picked = products?.flatMap((product) =>
          product.variants.flatMap((variant) =>
            variant.id
              ? [
                  {
                    id: variant.id,
                    name: variant.displayName || product.title,
                  },
                ]
              : [],
          ),
        );
      } else {
        const variants = await shopify.resourcePicker({
          type: "variant",
          multiple: 50,
        });
        picked = variants?.map((variant) => ({
          id: variant.id,
          name: variant.displayName || variant.title,
        }));
      }
      if (!picked) return;
      const additions = [
        ...new Map(picked.map((variant) => [variant.id, variant])).values(),
      ].filter((variant) => !items.some(({ id }) => id === variant.id));
      if (items.length + additions.length > 50) {
        setError("Choose up to 50 variants per simulation.");
        return;
      }
      setItems([
        ...items,
        ...additions.map((variant) => ({ ...variant, quantity: "1" })),
      ]);
    } catch {
      setError(
        "Shopify could not open the product picker. Check product access and try again.",
      );
    } finally {
      setPicking(false);
    }
  }

  function simulate() {
    if (!valid || busy) return;
    const form = new FormData();
    form.set("intent", "run");
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    form.set("items", serializedItems);
    form.set("testIdentity", testIdentity ? "yes" : "no");
    selected.forEach((id) => form.append("scenario", id));
    form.set("includeCombined", includeCombined ? "yes" : "no");
    selectedCombined.forEach((id) => form.append("combined", id));
    setLastInput(inputKey);
    run.submit(form, { method: "post" });
  }

  return (
    <s-stack gap="base">
      {!initial.connected ? (
        <s-banner
          tone="info"
          heading="Preview your rates before connecting calculated shipping"
        >
          <s-paragraph>
            You can preview a saved scenario here. Connect ShipFlow in Rates
            before it can quote at checkout.
          </s-paragraph>
          <s-button slot="secondary-actions" href={ratesPaths.hub}>
            Open Rates
          </s-button>
        </s-banner>
      ) : null}
      {!initial.context ? (
        <s-banner tone="warning" heading="Store currency is unavailable">
          <s-button
            slot="secondary-actions"
            loading={revalidator.state !== "idle"}
            onClick={() => revalidator.revalidate()}
          >
            Refresh
          </s-button>
        </s-banner>
      ) : null}
      <s-section heading="Cart items">
        <s-stack gap="base">
          {error ? (
            <s-banner tone="warning">
              <s-paragraph>{error}</s-paragraph>
            </s-banner>
          ) : null}
          {!items.length ? (
            <s-paragraph>
              Add Shopify variants to build the cart you want to test.
            </s-paragraph>
          ) : null}
          {items.map((item) => (
            <s-box
              key={item.id}
              padding="base"
              border="base"
              borderRadius="base"
            >
              <s-stack
                gap="small"
                direction="inline"
                alignItems="end"
                justifyContent="space-between"
              >
                <s-text>{item.name}</s-text>
                <s-number-field
                  label={`Quantity for ${item.name}`}
                  value={item.quantity}
                  min={1}
                  max={9999}
                  step={1}
                  disabled={busy}
                  onInput={(event) => {
                    const quantity = event.currentTarget.value;
                    setItems((previous) =>
                      previous.map((line) =>
                        line.id === item.id ? { ...line, quantity } : line,
                      ),
                    );
                  }}
                />
                <s-button
                  variant="tertiary"
                  accessibilityLabel={`Remove ${item.name}`}
                  disabled={busy}
                  onClick={() =>
                    setItems((previous) =>
                      previous.filter(({ id }) => id !== item.id),
                    )
                  }
                >
                  Remove
                </s-button>
              </s-stack>
            </s-box>
          ))}
          <s-stack direction="inline" gap="small" justifyContent="end">
            <s-button
              disabled={busy || picking || items.length >= 50}
              onClick={() => void addItems(true)}
            >
              Add from collection
            </s-button>
            <s-button
              variant="primary"
              disabled={busy || picking || items.length >= 50}
              onClick={() => void addItems(false)}
            >
              Add variants
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
      <s-section heading="Destination">
        <s-stack gap="base">
          <s-select
            label="Country"
            required
            value={values.country}
            disabled={busy}
            onChange={(event) => {
              const country = event.currentTarget.value;
              setValues((previous) => ({
                ...previous,
                country,
                province: "",
                city: "",
                postal: "",
                street: "",
              }));
            }}
          >
            <s-option value="" disabled>
              Select a country
            </s-option>
            {countries.map(({ code, label }) => (
              <s-option key={code} value={code}>
                {label}
              </s-option>
            ))}
          </s-select>
          <s-text-field
            label="Province or state code"
            value={values.province}
            maxLength={8}
            disabled={busy}
            onInput={(event) => update("province", event.currentTarget.value)}
          />
          <s-text-field
            label="City"
            value={values.city}
            maxLength={100}
            disabled={busy}
            onInput={(event) => update("city", event.currentTarget.value)}
          />
          <s-text-field
            label="Postal code"
            value={values.postal}
            maxLength={24}
            disabled={busy}
            onInput={(event) => update("postal", event.currentTarget.value)}
          />
          <s-text-field
            label="Street address"
            value={values.street}
            maxLength={200}
            disabled={busy}
            onInput={(event) => update("street", event.currentTarget.value)}
          />
        </s-stack>
      </s-section>
      <s-section heading="Checkout options">
        <s-stack gap="base">
          {initial.useDiscountedTotal ? (
            <s-text-field
              label={`Cart discount (${initial.context?.currency ?? ""})`}
              value={values.discount}
              maxLength={24}
              disabled={busy}
              onInput={(event) => update("discount", event.currentTarget.value)}
            />
          ) : null}
          <s-text-field
            label="Company"
            value={values.company}
            maxLength={120}
            disabled={busy}
            onInput={(event) => update("company", event.currentTarget.value)}
          />
          <s-select
            label="Ship from"
            value={values.location}
            disabled={busy || !initial.locations?.length}
            onChange={(event) => update("location", event.currentTarget.value)}
          >
            <s-option value="">
              {initial.context?.country
                ? `Store address country (${initial.context.country})`
                : "Default origin"}
            </s-option>
            {initial.locations?.map(({ id, name }) => (
              <s-option key={id} value={id}>
                {name}
              </s-option>
            ))}
          </s-select>
          {initial.locations === null ? (
            <s-paragraph>
              Shopify locations are unavailable. The store address country is
              used.
            </s-paragraph>
          ) : null}
          <s-text-field
            label="Checkout language code"
            placeholder="en-CA"
            value={values.language}
            maxLength={30}
            disabled={busy}
            onInput={(event) => update("language", event.currentTarget.value)}
          />
          {customerAccess ? (
            <s-stack gap="small">
              <s-search-field
                label="Find customer"
                value={query}
                maxLength={80}
                disabled={busy}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <s-stack direction="inline" justifyContent="end">
                <s-button
                  disabled={query.trim().length < 2 || busy || searching}
                  loading={searching}
                  onClick={() => {
                    const term = query.trim();
                    setLastSearch(term);
                    customers.submit(
                      { intent: "customers", query: term },
                      { method: "post" },
                    );
                  }}
                >
                  Search customers
                </s-button>
              </s-stack>
              {!searching &&
              lastSearch === query.trim() &&
              customers.data?.kind === "error" ? (
                <s-banner tone="warning">
                  <s-paragraph>{customers.data.message}</s-paragraph>
                </s-banner>
              ) : null}
              {!searching &&
              lastSearch === query.trim() &&
              customers.data?.kind === "customers" &&
              !foundCustomers.length ? (
                <s-paragraph>No customers found.</s-paragraph>
              ) : null}
              <s-select
                label="Customer"
                value={values.customer}
                disabled={busy}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  setChosenCustomer(
                    customerOptions.find((customer) => customer.id === id),
                  );
                  update("customer", id);
                }}
              >
                <s-option value="">Guest checkout</s-option>
                {customerOptions.map(({ id, name }) => (
                  <s-option key={id} value={id}>
                    {name}
                  </s-option>
                ))}
              </s-select>
            </s-stack>
          ) : (
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
              gap="small"
            >
              <s-text>Customer: Guest checkout</s-text>
              <s-button
                disabled={busy}
                onClick={async () => {
                  try {
                    const response = await shopify.scopes.request([
                      "read_customers",
                    ]);
                    setCustomerAccess(
                      response.detail.granted.includes("read_customers"),
                    );
                  } catch {
                    shopify.toast.show(
                      "Customer access could not be requested. Try again.",
                      { isError: true },
                    );
                  }
                }}
              >
                Allow customer selection
              </s-button>
            </s-stack>
          )}
          {initial.testMode ? (
            <s-checkbox
              label="Use the Test Mode identity"
              details="Use shipflow as the checkout first name."
              checked={testIdentity}
              disabled={busy}
              onChange={(event) => setTestIdentity(event.currentTarget.checked)}
            />
          ) : null}
        </s-stack>
      </s-section>
      <s-section heading="Scenarios">
        <s-stack gap="small">
          <s-paragraph>
            Active scenarios run by default. Select specific scenarios to
            preview them, including inactive drafts.
          </s-paragraph>
          {initial.scenarios.length ? (
            initial.scenarios.map(({ id, name, active }) => (
              <s-checkbox
                key={id}
                label={active ? name : `${name} (inactive)`}
                checked={selected.includes(id)}
                disabled={busy}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((previous) =>
                    checked
                      ? [...previous, id]
                      : previous.filter((value) => value !== id),
                  );
                }}
              />
            ))
          ) : (
            <s-button href={ratesPaths.scenario("new")}>
              Create scenario
            </s-button>
          )}
        </s-stack>
      </s-section>
      {initial.combinedRules.length ? (
        <s-section heading="Combined rates">
          <s-stack gap="small">
            <s-checkbox
              label="Apply combined rates"
              checked={includeCombined}
              disabled={busy}
              onChange={(event) =>
                setIncludeCombined(event.currentTarget.checked)
              }
            />
            {includeCombined ? (
              <>
                <s-paragraph>
                  Active rules run in their saved order. Select specific rules
                  to preview them, including inactive drafts.
                </s-paragraph>
                {initial.combinedRules.map(({ id, name, active }) => (
                  <s-checkbox
                    key={id}
                    label={active ? name : `${name} (inactive)`}
                    checked={selectedCombined.includes(id)}
                    disabled={busy}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedCombined((current) =>
                        checked
                          ? [...new Set([...current, id])]
                          : current.filter((value) => value !== id),
                      );
                    }}
                  />
                ))}
                <s-link href={combinedPaths.list}>Manage combined rates</s-link>
              </>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
      {!busy && inputKey === lastInput && run.data?.kind === "error" ? (
        <s-banner tone="critical">
          <s-paragraph>{run.data.message}</s-paragraph>
        </s-banner>
      ) : null}
      <s-stack gap="small" direction="inline" justifyContent="end">
        <s-button href={diagnosticsPaths.history}>
          View checkout history
        </s-button>
        <s-button
          variant="primary"
          disabled={!valid || busy || picking}
          loading={busy}
          onClick={simulate}
        >
          Run simulation
        </s-button>
      </s-stack>
      {result ? (
        <>
          <CheckoutPricingResults
            reason={result.result.reason}
            trace={result.result.trace}
            rateCount={result.result.rates.length}
          />
          <CheckoutCartDetails snapshot={result.cart} />
        </>
      ) : null}
      <s-paragraph>
        Simulator runs stay here. Use a real checkout to test Delivery
        Customization and check the request in History.
      </s-paragraph>
    </s-stack>
  );
}
