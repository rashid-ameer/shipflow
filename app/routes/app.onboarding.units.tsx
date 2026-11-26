import { BorderedCard } from "../components/bordered-card";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import {
  continueFromWelcome,
  getOrCreateShop,
  OnboardingStep,
  parseUnits,
  saveUnits,
  type UnitInput,
  updateUnits,
} from "../models/shop-settings.server";
import {
  unitFormValuesAreDirty,
  unitFormValuesFromSettings,
  validateUnitFormValues,
  type UnitFormValues,
} from "../models/unit-form";
import { authenticate } from "../shopify.server";

const SAVE_BAR_ID = "onboarding-units-save-bar";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const existing = await getOrCreateShop(session.shop);
  if (existing.onboardingStep === OnboardingStep.WELCOME) {
    await continueFromWelcome(session.shop);
  }
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep === OnboardingStep.COMPLETE) throw redirect("/app");
  return { settings: store.settings };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.onboardingStep === OnboardingStep.WELCOME) {
    throw redirect("/app/onboarding");
  }
  if (store.onboardingStep === OnboardingStep.COMPLETE) throw redirect("/app");
  const formData = await request.formData();
  const result = parseUnits(formData);
  if (!result.ok) return data(result, { status: 400 });

  if (formData.get("intent") === "continue") {
    const saved = store.settings;
    const hasUnsavedChanges =
      result.value.weightUnit !== saved.weightUnit ||
      result.value.distanceUnit !== saved.distanceUnit ||
      result.value.dimensionUnit !== saved.dimensionUnit ||
      result.value.volumetricDivisor !== saved.volumetricDivisor;

    if (hasUnsavedChanges) {
      return data(
        {
          ok: false as const,
          fields: {},
          values: {
            weightUnit: result.value.weightUnit,
            distanceUnit: result.value.distanceUnit,
            dimensionUnit: result.value.dimensionUnit,
            volumetricDivisor: String(result.value.volumetricDivisor),
          },
        },
        { status: 409 },
      );
    }

    await saveUnits(session.shop, result.value);
    return redirect("/app/onboarding/mode");
  }

  await updateUnits(session.shop, result.value);
  return data({
    ok: true as const,
    saved: true as const,
    values: {
      weightUnit: result.value.weightUnit,
      distanceUnit: result.value.distanceUnit,
      dimensionUnit: result.value.dimensionUnit,
      volumetricDivisor: String(result.value.volumetricDivisor),
    },
  });
}

export default function OnboardingUnits() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const initialValues = unitFormValuesFromSettings(settings);
  const savedValuesRef = useRef<UnitFormValues>(initialValues);
  const [formValues, setFormValues] = useState<UnitFormValues>(initialValues);
  const formValuesRef = useRef<UnitFormValues>(initialValues);
  const [dirty, setDirty] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [fieldsReady, setFieldsReady] = useState(false);
  const serverErrors: Partial<Record<keyof UnitInput, string>> =
    actionData && !actionData.ok ? actionData.fields : {};
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<keyof UnitInput, string>>
  >({});
  const errors = { ...serverErrors, ...clientErrors };
  const submitting = navigation.state === "submitting";
  const continuing =
    submitting && navigation.formData?.get("intent") === "continue";
  const saving =
    submitting && navigation.formData?.get("intent") !== "continue";

  useEffect(() => {
    let active = true;
    void Promise.all([
      customElements.whenDefined("s-select"),
      customElements.whenDefined("s-number-field"),
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
    if (actionData?.ok && "saved" in actionData && actionData.saved) {
      savedValuesRef.current = actionData.values;
      formValuesRef.current = actionData.values;
      setFormValues(actionData.values);
      setDirty(false);
      setClientErrors({});
      setResetVersion((version) => version + 1);
    }
  }, [actionData]);

  useEffect(() => {
    if (!fieldsReady) return;
    if (dirty) {
      void shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      void shopify.saveBar.hide(SAVE_BAR_ID);
    }
  }, [dirty, fieldsReady, shopify]);

  useEffect(() => {
    return () => {
      void shopify.saveBar.hide(SAVE_BAR_ID);
    };
  }, [shopify]);

  const applyValues = (nextValues: UnitFormValues) => {
    formValuesRef.current = nextValues;
    setFormValues(nextValues);
    setDirty(unitFormValuesAreDirty(nextValues, savedValuesRef.current));
  };

  const updateField = (event: Event) => {
    const field = event.currentTarget as EventTarget & {
      name: keyof UnitFormValues;
      value: string;
    };
    if (!field.name) return;
    const nextValues = {
      ...formValuesRef.current,
      [field.name]: field.value,
    };
    setClientErrors((currentErrors) => ({
      ...currentErrors,
      [field.name]: undefined,
    }));
    applyValues(nextValues);
  };

  const discardChanges = () => {
    applyValues({ ...savedValuesRef.current });
    setClientErrors({});
    setResetVersion((version) => version + 1);
  };

  const saveChanges = () => {
    const nextErrors = validateUnitFormValues(formValuesRef.current);
    setClientErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      void shopify.saveBar.show(SAVE_BAR_ID);
      return;
    }
    submit(formValuesRef.current, { method: "post" });
  };

  const blinkSaveBar = async () => {
    await shopify.saveBar.hide(SAVE_BAR_ID);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    await shopify.saveBar.show(SAVE_BAR_ID);
  };

  const continueOnboarding = async () => {
    if (dirty) {
      await blinkSaveBar();
      return;
    }
    submit(
      { ...formValuesRef.current, intent: "continue" },
      { method: "post" },
    );
  };

  const backToWelcome = async () => {
    if (dirty) {
      await blinkSaveBar();
      return;
    }
    navigate("/app/onboarding");
  };

  return (
    <s-page heading="Units of measurement" inlineSize="base">
      <ui-save-bar id={SAVE_BAR_ID}>
        <button variant="primary" disabled={saving} onClick={saveChanges}>
          Save
        </button>
        <button disabled={saving} onClick={discardChanges}>
          Discard
        </button>
      </ui-save-bar>
      <s-stack direction="block" gap="base">
        <Form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            saveChanges();
          }}
        >
          <BorderedCard heading="Measurement defaults">
            <s-stack key={resetVersion} direction="block" gap="base">
              <s-select
                label="Weight unit"
                name="weightUnit"
                value={formValues.weightUnit}
                error={errors.weightUnit}
                onChange={updateField}
                onInput={updateField}
                disabled={!fieldsReady}
                required
              >
                <s-option value="g">Grams (g)</s-option>
                <s-option value="kg">Kilograms (kg)</s-option>
                <s-option value="lb">Pounds (lb)</s-option>
                <s-option value="oz">Ounces (oz)</s-option>
              </s-select>
              <s-select
                label="Distance unit"
                name="distanceUnit"
                value={formValues.distanceUnit}
                error={errors.distanceUnit}
                onChange={updateField}
                onInput={updateField}
                disabled={!fieldsReady}
                required
              >
                <s-option value="km">Kilometers (km)</s-option>
                <s-option value="mi">Miles (mi)</s-option>
              </s-select>
              <s-select
                label="Dimension unit"
                name="dimensionUnit"
                value={formValues.dimensionUnit}
                error={errors.dimensionUnit}
                onChange={updateField}
                onInput={updateField}
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
                value={formValues.volumetricDivisor}
                min={0.01}
                step={0.01}
                inputMode="decimal"
                details="Volumetric weight = (L × W × H) ÷ divisor. Common values are 5000 for cm/kg and 139 for in/lb."
                error={errors.volumetricDivisor}
                onInput={updateField}
                onChange={updateField}
                disabled={!fieldsReady}
                required
              />
            </s-stack>
          </BorderedCard>
        </Form>
        <s-stack direction="inline" justifyContent="end">
          <s-button-group>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              disabled={!fieldsReady || submitting}
              onClick={backToWelcome}
            >
              Back
            </s-button>
            <s-button
              slot="primary-action"
              variant="primary"
              loading={continuing}
              disabled={!fieldsReady || submitting}
              onClick={continueOnboarding}
            >
              Continue
            </s-button>
          </s-button-group>
        </s-stack>
      </s-stack>
    </s-page>
  );
}
