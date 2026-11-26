import { BorderedCard } from "./bordered-card";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useBlocker,
  useFetcher,
  useNavigate,
  useRevalidator,
} from "react-router";
import {
  dateFormats,
  weekdays,
  type Appearance,
  type ShippingConfiguration,
} from "../models/checkout-settings";

export const settingsTabs = {
  basic: "Basic app setup",
  markets: "Markets",
  regions: "Regions",
  shipping: "Shipping configuration",
  sync: "Sync setting",
  appearance: "Appearance",
  integrations: "Integrations",
  carriers: "Carriers",
};
export type SettingsTab = keyof typeof settingsTabs;

export function SettingsTabs({ current }: { current: SettingsTab }) {
  const navigate = useNavigate();
  return (
    <nav aria-label="Shipping settings">
      <s-stack direction="inline" gap="small">
        {Object.entries(settingsTabs).map(([tab, name]) => (
          <s-button
            key={tab}
            variant={current === tab ? "secondary" : "tertiary"}
            aria-current={current === tab ? "page" : undefined}
            onClick={() => {
              if (current !== tab)
                void navigate(
                  tab === "basic"
                    ? "/app/settings"
                    : `/app/settings?tab=${tab}`,
                );
            }}
          >
            {name}
          </s-button>
        ))}
      </s-stack>
    </nav>
  );
}

type Response = { ok: boolean; error?: string | null; message?: string };

function PreferenceForm({
  title,
  intent,
  initial,
  fields,
}: {
  title: string;
  intent: string;
  initial: Record<string, string>;
  fields: (
    values: Record<string, string>,
    change: (name: string, value: string) => void,
    busy: boolean,
  ) => ReactNode;
}) {
  const fetcher = useFetcher<Response>();
  const shopify = useAppBridge();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const dirty = Object.keys(form).some((key) => form[key] !== saved[key]);
  const busy = fetcher.state !== "idle";
  const blocker = useBlocker(dirty);
  const handled = useRef<Response | undefined>(undefined);
  const saveBar = `settings-${intent}`;
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    blocker.reset();
    void shopify.saveBar.leaveConfirmation?.();
  }, [blocker, shopify]);
  useEffect(() => {
    if (dirty) void shopify.saveBar.show?.(saveBar);
    else void shopify.saveBar.hide?.(saveBar);
    return () => {
      void shopify.saveBar.hide?.(saveBar);
    };
  }, [dirty, saveBar, shopify]);
  useEffect(() => {
    if (busy || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) {
      setSaved(initial);
      setForm(initial);
      shopify.toast.show("Settings saved");
    }
  }, [busy, fetcher.data, initial, shopify]);
  const change = (name: string, value: string) =>
    setForm((previous) => ({ ...previous, [name]: value }));
  function save() {
    const body = new FormData();
    for (const [key, value] of Object.entries(form)) {
      if (key.startsWith("weekday-")) {
        if (value === "true") body.append("excluded", key.slice(8));
      } else body.set(key, value);
    }
    body.set("intent", intent);
    fetcher.submit(body, { method: "post" });
  }
  return (
    <BorderedCard heading={title}>
      <ui-save-bar id={saveBar}>
        <button
          type="button"
          variant="primary"
          disabled={busy || !dirty}
          onClick={save}
        >
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => setForm(saved)}>
          Discard
        </button>
      </ui-save-bar>
      <s-stack gap="base">
        {fetcher.data?.error ? (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        ) : null}
        {fields(form, change, busy)}
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            disabled={!dirty || busy}
            loading={busy}
            onClick={save}
          >
            Save
          </s-button>
          {dirty ? (
            <s-button disabled={busy} onClick={() => setForm(saved)}>
              Discard
            </s-button>
          ) : null}
        </s-stack>
      </s-stack>
    </BorderedCard>
  );
}

export function ShippingSettings({
  initial,
  discounted,
  currency,
}: {
  initial: ShippingConfiguration;
  discounted: boolean;
  currency?: string;
}) {
  const values = {
    discounted: String(discounted),
    preventDoubling: String(initial.preventDoubling),
    ukPostal: String(initial.ukPostal),
    manualCodes: String(initial.manualCodes),
    fallbackEnabled: String(Boolean(initial.fallback)),
    fallbackName: initial.fallback?.name ?? "",
    fallbackDescription: initial.fallback?.description ?? "",
    fallbackKind: initial.fallback?.kind ?? "fixed",
    fallbackValue: initial.fallback?.value ?? "",
  };
  const toggles = {
    discounted: "Use discounted cart total for shipping rate calculation",
    preventDoubling: "Prevent duplicate flat rates",
    ukPostal: "Enable UK postcode wildcards",
    manualCodes: "Enter shipping rate codes manually",
    fallbackEnabled: "Enable store fallback rate",
  };
  return (
    <PreferenceForm
      title="Shipping configuration"
      intent="save-shipping"
      initial={values}
      fields={(form, change, busy): ReactNode => (
        <>
          {Object.entries(toggles).map(([key, label]) => (
            <s-checkbox
              key={key}
              label={label}
              checked={form[key] === "true"}
              disabled={busy}
              onChange={(event) =>
                change(key, String(event.currentTarget.checked))
              }
            />
          ))}
          {form.preventDoubling === "true" ? (
            <s-paragraph>
              Identical flat options are merged within a ShipFlow response. For
              one charge across fulfillment locations, configure a Shopify flat
              rate in the same location group.{" "}
              <s-link
                href="https://help.shopify.com/en/manual/fulfillment/setup/shipping-profiles/combined-shipping-rates"
                target="_blank"
              >
                Shopify guide
              </s-link>
            </s-paragraph>
          ) : null}
          {form.fallbackEnabled === "true" ? (
            <>
              <s-text-field
                label="Fallback name"
                value={form.fallbackName}
                disabled={busy}
                maxLength={120}
                onInput={(event) =>
                  change("fallbackName", event.currentTarget.value)
                }
              />
              <s-text-area
                label="Fallback description"
                value={form.fallbackDescription}
                disabled={busy}
                maxLength={250}
                onInput={(event) =>
                  change("fallbackDescription", event.currentTarget.value)
                }
              />
              <s-select
                label="Fallback rate type"
                value={form.fallbackKind}
                disabled={busy}
                onChange={(event) =>
                  change("fallbackKind", event.currentTarget.value)
                }
              >
                <s-option value="fixed">Fixed amount</s-option>
                <s-option value="percent">Percentage of cart total</s-option>
              </s-select>
              <s-text-field
                label={`Fallback amount (${form.fallbackKind === "percent" ? "%" : (currency ?? "store currency")})`}
                value={form.fallbackValue}
                disabled={busy}
                onInput={(event) =>
                  change("fallbackValue", event.currentTarget.value)
                }
              />
            </>
          ) : null}
        </>
      )}
    />
  );
}

export function AppearanceSettings({ initial }: { initial: Appearance }) {
  const values = {
    label: initial.label,
    precise: String(initial.precise),
    format: initial.format,
    custom: initial.custom,
    ...Object.fromEntries(
      weekdays.map((_, index) => [
        `weekday-${index}`,
        String(initial.excluded.includes(index)),
      ]),
    ),
  };
  return (
    <PreferenceForm
      title="Appearance"
      intent="save-appearance"
      initial={values}
      fields={(form, change, busy): ReactNode => (
        <>
          <s-text-field
            label="Business-days label"
            value={form.label}
            maxLength={50}
            disabled={busy}
            onInput={(event) => change("label", event.currentTarget.value)}
          />
          <s-checkbox
            label="Show precise dates for delivery estimates"
            checked={form.precise === "true"}
            disabled={busy}
            onChange={(event) =>
              change("precise", String(event.currentTarget.checked))
            }
          />
          {form.precise === "true" ? (
            <>
              <s-select
                label="Delivery date format"
                value={form.format}
                disabled={busy}
                onChange={(event) =>
                  change("format", event.currentTarget.value)
                }
              >
                {dateFormats.map((format) => (
                  <s-option key={format} value={format}>
                    {format === "custom" ? "Custom" : format}
                  </s-option>
                ))}
              </s-select>
              {form.format === "custom" ? (
                <s-text-field
                  label="Custom date format"
                  details="Use YYYY, MM and DD once each."
                  value={form.custom}
                  maxLength={24}
                  disabled={busy}
                  onInput={(event) =>
                    change("custom", event.currentTarget.value)
                  }
                />
              ) : null}
            </>
          ) : null}
          <s-heading>Days excluded from delivery estimates</s-heading>
          <s-stack direction="inline" gap="small">
            {[1, 2, 3, 4, 5, 6, 0].map((index) => (
              <s-checkbox
                key={index}
                label={weekdays[index]}
                checked={form[`weekday-${index}`] === "true"}
                disabled={busy}
                onChange={(event) =>
                  change(
                    `weekday-${index}`,
                    String(event.currentTarget.checked),
                  )
                }
              />
            ))}
          </s-stack>
        </>
      )}
    />
  );
}

export function ProductSyncSettings({
  auto,
  job,
  error,
  syncedAt,
}: {
  auto: boolean;
  job?: string | null;
  error?: string | null;
  syncedAt?: string;
}) {
  const fetcher = useFetcher<Response>();
  const { revalidate } = useRevalidator();
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (!job || busy) return;
    const timer = window.setInterval((): void => {
      void revalidate();
    }, 3000);
    return (): void => window.clearInterval(timer);
  }, [job, busy, revalidate]);
  const submit = (values: Record<string, string>) =>
    fetcher.submit(values, { method: "post", action: "/app/products" });
  return (
    <BorderedCard heading="Product sync">
      <s-stack gap="base">
        {fetcher.data?.error || error ? (
          <s-banner tone="critical">{fetcher.data?.error ?? error}</s-banner>
        ) : null}
        {fetcher.data?.message ? (
          <s-banner tone="success">{fetcher.data.message}</s-banner>
        ) : null}
        <s-checkbox
          label="Sync products automatically each day"
          checked={auto}
          disabled={busy}
          onChange={(event) =>
            submit({
              intent: "automatic",
              enabled: String(event.currentTarget.checked),
            })
          }
        />
        {job ? (
          <s-paragraph>Product sync queued or running.</s-paragraph>
        ) : null}
        {syncedAt ? (
          <s-text>
            Last sync {syncedAt.slice(0, 16).replace("T", " ")} UTC
          </s-text>
        ) : null}
        <s-stack direction="inline" gap="small">
          <s-button
            disabled={busy || Boolean(job)}
            loading={busy && fetcher.formData?.get("intent") === "sync"}
            onClick={() => submit({ intent: "sync" })}
          >
            Sync products
          </s-button>
          <s-link href="/app/products">Open Products</s-link>
        </s-stack>
      </s-stack>
    </BorderedCard>
  );
}

export function MapsSettings({ connected }: { connected: boolean }) {
  const fetcher = useFetcher<Response>();
  const [key, setKey] = useState("");
  const handled = useRef<Response | undefined>(undefined);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (!busy && fetcher.data?.ok && handled.current !== fetcher.data) {
      handled.current = fetcher.data;
      setKey("");
    }
  }, [busy, fetcher.data]);
  const submit = (intent: string) =>
    fetcher.submit(
      { intent, ...(intent === "connect-maps" ? { key } : {}) },
      { method: "post" },
    );
  return (
    <BorderedCard heading="Google Maps">
      <s-stack gap="base">
        <s-badge tone={connected ? "success" : "neutral"}>
          {connected ? "Connected" : "Not connected"}
        </s-badge>
        <s-paragraph>
          Driving distance powers distance conditions and pricing. Enable the
          Google Routes API on your API key.
        </s-paragraph>
        {fetcher.data?.error ? (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        ) : null}
        {fetcher.data?.message ? (
          <s-banner tone="success">{fetcher.data.message}</s-banner>
        ) : null}
        <s-password-field
          label="Google Maps API key"
          value={key}
          disabled={busy}
          onInput={(event) => setKey(event.currentTarget.value)}
        />
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            disabled={busy || !key.trim()}
            loading={busy && fetcher.formData?.get("intent") === "connect-maps"}
            onClick={() => submit("connect-maps")}
          >
            {connected ? "Test and replace key" : "Test and connect"}
          </s-button>
          {connected ? (
            <s-button
              tone="critical"
              disabled={busy}
              onClick={() => submit("disconnect-maps")}
            >
              Disconnect
            </s-button>
          ) : null}
        </s-stack>
      </s-stack>
    </BorderedCard>
  );
}
