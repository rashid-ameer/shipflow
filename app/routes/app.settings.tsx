import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  data,
  redirect,
  useBlocker,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { getShopLocale } from "../models/shop-locale.server";
import {
  changeDeliveryRuntime,
  syncErrorMessage,
} from "../models/delivery-customization.server";
import {
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  OperatingMode,
  parseOperatingMode,
  switchOperatingMode,
  updateBasicSettings,
  updateDeliverySettings,
} from "../models/shop-settings.server";
import {
  parseBasicSettingsFormData,
  parseDeliverySettingsFormData,
  settingsFormValuesAreDirty,
  settingsFormValuesFromStore,
  validateBasicSettingsFormValues,
  validateDeliverySettingsFormValues,
  type BasicSettingsErrors,
  type BasicSettingsFormValues,
} from "../models/shipping-settings";
import { authenticate } from "../shopify.server";
import {
  changeUpsConnection,
  getUpsConnection,
} from "../models/live-carrier.server";
import { CarrierFailure } from "../models/ups-rating.server";
import { carriers } from "../models/live-carrier";
import { UpsConnectionPanel } from "../components/carrier-connection";

const SAVE_BAR_ID = "settings-save-bar";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || !store.mode) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }
  const carrierTab =
    new URL(request.url).searchParams.get("tab") === "carriers" &&
    store.mode === OperatingMode.CCS_RATES;
  return {
    carrierTab,
    connection: carrierTab ? await getUpsConnection(store.id) : null,
    mode:
      store.mode === OperatingMode.CCS_RATES
        ? ("ccs-rates" as const)
        : ("delivery-customization" as const),
    values: settingsFormValuesFromStore(store),
    shopLocale:
      store.mode === OperatingMode.CCS_RATES && !carrierTab
        ? await getShopLocale((query) => admin.graphql(query))
        : null,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || !store.mode) {
    throw redirect(nextOnboardingPath(store.onboardingStep));
  }
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (
    [
      "carrier-connect",
      "carrier-sync",
      "carrier-test",
      "carrier-disconnect",
    ].includes(String(intent))
  ) {
    if (store.mode !== OperatingMode.CCS_RATES)
      throw new Response("Carrier connections require CCS Rates mode.", {
        status: 403,
      });
    try {
      return {
        ok: true as const,
        kind: "carrier" as const,
        message: await changeUpsConnection(store.id, formData),
        error: null,
      };
    } catch (error) {
      return data(
        {
          ok: false as const,
          kind: "carrier" as const,
          error:
            error instanceof CarrierFailure
              ? error.message
              : "The UPS connection could not be updated.",
        },
        { status: error instanceof CarrierFailure ? 400 : 500 },
      );
    }
  }

  if (intent === "switch-mode") {
    const mode = parseOperatingMode(formData.get("mode"));
    if (!mode) {
      return data(
        {
          ok: false as const,
          kind: "mode" as const,
          error: "Choose a valid operating mode.",
        },
        { status: 400 },
      );
    }
    try {
      await changeDeliveryRuntime(admin.graphql, session.shop, { mode }, (tx) =>
        switchOperatingMode(session.shop, mode, tx),
      );
      return { ok: true as const, kind: "mode" as const, error: null };
    } catch (error) {
      if (error instanceof Response) throw error;
      return data(
        {
          ok: false as const,
          kind: "mode" as const,
          error: syncErrorMessage(error),
        },
        { status: 500 },
      );
    }
  }

  const submittedMode = parseOperatingMode(formData.get("mode"));
  if (intent !== "save-settings" || submittedMode !== store.mode) {
    return data(
      {
        ok: false as const,
        kind: "settings" as const,
        fields: {},
        error: "Settings could not be saved. Reopen Settings and try again.",
      },
      { status: 409 },
    );
  }
  const parsed =
    store.mode === OperatingMode.CCS_RATES
      ? { ...parseBasicSettingsFormData(formData), mode: "ccs-rates" as const }
      : {
          ...parseDeliverySettingsFormData(formData),
          mode: "delivery-customization" as const,
        };
  if (!parsed.ok) {
    return data(
      {
        ok: false as const,
        kind: "settings" as const,
        fields: parsed.fields,
        error: null,
      },
      { status: 400 },
    );
  }

  try {
    const saved =
      parsed.mode === "ccs-rates"
        ? await updateBasicSettings(session.shop, parsed.value)
        : await changeDeliveryRuntime(
            admin.graphql,
            session.shop,
            { appEnabled: parsed.value.appEnabled },
            (tx) => updateDeliverySettings(session.shop, parsed.value, tx),
          );
    return {
      ok: true as const,
      kind: "settings" as const,
      values: settingsFormValuesFromStore(saved),
      fields: {},
      error: null,
    };
  } catch (error) {
    return data(
      {
        ok: false as const,
        kind: "settings" as const,
        fields: {},
        error: `${syncErrorMessage(error)} Your changes are still here.`,
      },
      { status: 500 },
    );
  }
}

export default function Settings() {
  const settings = useLoaderData<typeof loader>();
  if (settings.carrierTab)
    return (
      <s-page heading="Carriers">
        <s-link slot="breadcrumb-actions" href="/app/settings">
          Settings
        </s-link>
        <s-section heading="UPS">
          <s-paragraph>
            Create a UPS application with Rating access and link your UPS
            shipper account.
          </s-paragraph>
          <s-link href="https://developer.ups.com/get-started" target="_blank">
            UPS setup instructions
          </s-link>
          <UpsConnectionPanel connection={settings.connection} />
        </s-section>
        <s-section heading="Other carriers">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
            gap="base"
          >
            {Object.entries(carriers)
              .filter(([code]) => code !== "ups")
              .map(([code, name]) => (
                <s-box
                  key={code}
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack gap="small">
                    <s-text type="strong">{name}</s-text>
                    <s-badge>Unavailable</s-badge>
                  </s-stack>
                </s-box>
              ))}
          </s-grid>
        </s-section>
      </s-page>
    );
  return <SettingsForm key={settings.mode} settings={settings} />;
}

function SettingsForm({
  settings,
}: {
  settings: Awaited<ReturnType<typeof loader>>;
}) {
  const saveFetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const switchModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const savedValuesRef = useRef<BasicSettingsFormValues>(settings.values);
  const valuesRef = useRef<BasicSettingsFormValues>(settings.values);
  const [values, setValues] = useState(settings.values);
  const [errors, setErrors] = useState<BasicSettingsErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [fieldsReady, setFieldsReady] = useState(false);
  const isCcs = settings.mode === "ccs-rates";
  const saving = saveFetcher.state !== "idle";
  const switching = modeFetcher.state !== "idle";
  const dirty = settingsFormValuesAreDirty(
    values,
    savedValuesRef.current,
    settings.mode,
  );
  const blocker = useBlocker(dirty);

  useEffect(() => {
    let active = true;
    void Promise.all([
      customElements.whenDefined("s-select"),
      customElements.whenDefined("s-number-field"),
      customElements.whenDefined("s-text-field"),
    ]).then(() => {
      window.requestAnimationFrame(() => {
        if (active) setFieldsReady(true);
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (dirty) void shopify.saveBar.show?.(SAVE_BAR_ID);
    else void shopify.saveBar.hide?.(SAVE_BAR_ID);
  }, [dirty, shopify]);

  useEffect(() => {
    return () => {
      void shopify.saveBar.hide?.(SAVE_BAR_ID);
    };
  }, [shopify]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    blocker.reset();
    void shopify.saveBar.leaveConfirmation?.();
  }, [blocker, shopify]);

  useEffect(() => {
    const result = saveFetcher.data;
    if (saveFetcher.state !== "idle" || result?.kind !== "settings") return;
    if (!result.ok) {
      setErrors(result.fields);
      setSaveError(result.error);
      return;
    }
    savedValuesRef.current = result.values;
    valuesRef.current = result.values;
    setValues(result.values);
    setErrors({});
    setSaveError(null);
    setResetVersion((version) => version + 1);
    shopify.toast.show("Settings saved");
  }, [saveFetcher.data, saveFetcher.state, shopify]);

  const applyValues = (nextValues: BasicSettingsFormValues) => {
    valuesRef.current = nextValues;
    setValues(nextValues);
  };

  const updateField = (event: Event) => {
    const field = event.currentTarget as EventTarget & {
      name: keyof BasicSettingsFormValues;
      value: string;
    };
    if (!field.name) return;
    setErrors((current) => ({ ...current, [field.name]: undefined }));
    applyValues({ ...valuesRef.current, [field.name]: field.value });
  };

  const discardChanges = () => {
    applyValues({ ...savedValuesRef.current });
    setErrors({});
    setSaveError(null);
    setResetVersion((version) => version + 1);
  };

  const saveChanges = () => {
    if (!dirty || saving || switching) return;
    const nextErrors = isCcs
      ? validateBasicSettingsFormValues(valuesRef.current)
      : validateDeliverySettingsFormValues(valuesRef.current);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      void shopify.saveBar.show?.(SAVE_BAR_ID);
      return;
    }
    saveFetcher.submit(
      { ...valuesRef.current, intent: "save-settings", mode: settings.mode },
      { method: "post" },
    );
  };

  const requestModeSwitch = async () => {
    if (dirty) {
      await shopify.saveBar.leaveConfirmation?.();
      return;
    }
    switchModalRef.current?.showOverlay();
  };

  const confirmModeSwitch = () => {
    modeFetcher.submit(
      {
        intent: "switch-mode",
        mode: isCcs ? "delivery-customization" : "ccs-rates",
      },
      { method: "post" },
    );
    switchModalRef.current?.hideOverlay();
  };

  return (
    <s-page heading="Settings">
      {isCcs ? (
        <s-button slot="secondary-actions" href="/app/settings?tab=carriers">
          Carriers
        </s-button>
      ) : null}
      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          type="button"
          variant="primary"
          disabled={saving}
          onClick={saveChanges}
        >
          Save
        </button>
        <button type="button" disabled={saving} onClick={discardChanges}>
          Discard
        </button>
      </ui-save-bar>

      <s-stack direction="block" gap="base">
        {saveError ? (
          <s-banner tone="critical" heading="Settings were not saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        ) : null}

        {modeFetcher.data?.kind === "mode" && !modeFetcher.data.ok ? (
          <s-banner tone="critical" heading="The mode was not changed">
            <s-paragraph>{modeFetcher.data.error}</s-paragraph>
          </s-banner>
        ) : null}

        <s-section heading="App status">
          <s-stack direction="block" gap="base">
            <s-select
              key={`status-${resetVersion}`}
              label="ShipFlow status"
              name="appStatus"
              value={values.appStatus}
              error={errors.appStatus}
              onChange={updateField}
              onInput={updateField}
              disabled={!fieldsReady || saving || switching}
              required
            >
              <s-option value="enabled">Enabled</s-option>
              <s-option value="disabled">Disabled</s-option>
            </s-select>
            <s-paragraph>
              Disabling ShipFlow stops checkout evaluation without deleting your
              saved rules or settings.
            </s-paragraph>
          </s-stack>
        </s-section>

        {isCcs && settings.shopLocale ? (
          <CcsSettings
            key={`ccs-${resetVersion}`}
            values={values}
            errors={errors}
            fieldsReady={fieldsReady && !saving && !switching}
            shopLocale={settings.shopLocale}
            onChange={updateField}
          />
        ) : (
          <DeliveryCustomizationSettings
            key={`delivery-${resetVersion}`}
            values={values}
            errors={errors}
            fieldsReady={fieldsReady && !saving && !switching}
            onChange={updateField}
          />
        )}

        <s-section heading="Operating mode">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-text type="strong">Current mode: </s-text>
              {isCcs ? "CCS Rates" : "Delivery Customization"}
            </s-paragraph>
            <s-paragraph>
              Only the current mode runs at checkout. Settings and rules in the
              other mode remain saved.
            </s-paragraph>
            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="secondary"
                disabled={saving || switching}
                loading={switching}
                onClick={requestModeSwitch}
              >
                Switch to {isCcs ? "Delivery Customization" : "CCS Rates"}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>

      <s-modal
        id="settings-switch-mode-modal"
        ref={switchModalRef as never}
        heading={`Switch to ${isCcs ? "Delivery Customization" : "CCS Rates"}?`}
      >
        <s-paragraph>
          Only one mode can run at checkout. Your current mode settings and
          rules will remain saved but will not run until you switch back.
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="settings-switch-mode-modal"
          command="--hide"
          variant="secondary"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={switching}
          disabled={switching}
          onClick={confirmModeSwitch}
        >
          Confirm switch
        </s-button>
      </s-modal>
    </s-page>
  );
}

function CcsSettings({
  values,
  errors,
  fieldsReady,
  shopLocale,
  onChange,
}: {
  values: BasicSettingsFormValues;
  errors: BasicSettingsErrors;
  fieldsReady: boolean;
  shopLocale: {
    currencyCode: string;
    ianaTimezone: string;
    available: boolean;
  };
  onChange: (event: Event) => void;
}) {
  return (
    <s-section heading="Basic app setup">
      <s-stack direction="block" gap="base">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
        >
          <s-text-field
            label="Store currency"
            value={shopLocale.currencyCode}
            disabled
          />
          <s-text-field
            label="Store time zone"
            value={shopLocale.ianaTimezone}
            disabled
          />
        </s-grid>
        {!shopLocale.available ? (
          <s-paragraph>
            Currency and time zone could not be loaded from Shopify. Your
            editable settings are still available.
          </s-paragraph>
        ) : null}
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
          gap="base"
        >
          <WeightUnitField
            values={values}
            errors={errors}
            disabled={!fieldsReady}
            onChange={onChange}
          />
          <s-select
            label="Distance unit"
            name="distanceUnit"
            value={values.distanceUnit}
            error={errors.distanceUnit}
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
            required
          >
            <s-option value="km">Kilometers (km)</s-option>
            <s-option value="mi">Miles (mi)</s-option>
          </s-select>
          <s-select
            label="Dimension unit"
            name="dimensionUnit"
            value={values.dimensionUnit}
            error={errors.dimensionUnit}
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
            required
          >
            <s-option value="mm">Millimeters (mm)</s-option>
            <s-option value="cm">Centimeters (cm)</s-option>
            <s-option value="m">Meters (m)</s-option>
            <s-option value="in">Inches (in)</s-option>
            <s-option value="ft">Feet (ft)</s-option>
          </s-select>
          <s-number-field
            label="Volumetric divisor"
            name="volumetricDivisor"
            value={values.volumetricDivisor}
            error={errors.volumetricDivisor}
            min={0.01}
            step={0.01}
            inputMode="decimal"
            details="Volumetric weight = (L × W × H) ÷ divisor. Common values are 5000 for cm/kg and 139 for in/lb."
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
            required
          />
          <s-select
            label="When multiple rates match"
            name="multipleRates"
            value={values.multipleRates}
            error={errors.multipleRates}
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
            required
          >
            <s-option value="all">Return all rates</s-option>
            <s-option value="highest">Return the highest rate</s-option>
            <s-option value="lowest">Return the lowest rate</s-option>
            <s-option value="priority">
              Return the highest-priority rate
            </s-option>
          </s-select>
          <s-select
            label="Price rounding"
            name="rounding"
            value={values.rounding}
            error={errors.rounding}
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
            required
          >
            <s-option value="none">No rounding</s-option>
            <s-option value="nearest-half">Nearest 0.50</s-option>
            <s-option value="nearest-one">Nearest 1.00</s-option>
            <s-option value="ceil">Round up to 1.00</s-option>
            <s-option value="floor">Round down to 1.00</s-option>
          </s-select>
          <s-select
            label="Cart total for shipping rates"
            name="cartTotalBasis"
            value={values.cartTotalBasis ?? "original"}
            onChange={onChange}
            onInput={onChange}
            disabled={!fieldsReady}
          >
            <s-option value="original">Before discounts</s-option>
            <s-option value="discounted">After discounts</s-option>
          </s-select>
        </s-grid>
      </s-stack>
    </s-section>
  );
}

function DeliveryCustomizationSettings({
  values,
  errors,
  fieldsReady,
  onChange,
}: {
  values: BasicSettingsFormValues;
  errors: BasicSettingsErrors;
  fieldsReady: boolean;
  onChange: (event: Event) => void;
}) {
  return (
    <s-section heading="Delivery Customization settings">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          This weight unit is used when ShipFlow evaluates weight-based delivery
          rules.
        </s-paragraph>
        <WeightUnitField
          values={values}
          errors={errors}
          disabled={!fieldsReady}
          onChange={onChange}
        />
      </s-stack>
    </s-section>
  );
}

function WeightUnitField({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: BasicSettingsFormValues;
  errors: BasicSettingsErrors;
  disabled: boolean;
  onChange: (event: Event) => void;
}) {
  return (
    <s-select
      label="Weight unit"
      name="weightUnit"
      value={values.weightUnit}
      error={errors.weightUnit}
      onChange={onChange}
      onInput={onChange}
      disabled={disabled}
      required
    >
      <s-option value="g">Grams (g)</s-option>
      <s-option value="kg">Kilograms (kg)</s-option>
      <s-option value="lb">Pounds (lb)</s-option>
      <s-option value="oz">Ounces (oz)</s-option>
    </s-select>
  );
}
