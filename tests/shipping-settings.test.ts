import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsPageLayout } from "../app/components/checkout-settings-panels";
import {
  parseBasicSettingsFormData,
  parseDeliverySettingsFormData,
  settingsFormValuesAreDirty,
  validateBasicSettingsFormValues,
  type BasicSettingsFormValues,
} from "../app/models/shipping-settings";

const saved: BasicSettingsFormValues = {
  appStatus: "enabled",
  weightUnit: "kg",
  distanceUnit: "km",
  dimensionUnit: "cm",
  volumetricDivisor: "5000",
  multipleRates: "all",
  rounding: "none",
};

assert.equal(settingsFormValuesAreDirty(saved, saved, "ccs-rates"), false);
assert.equal(
  settingsFormValuesAreDirty(
    { ...saved, distanceUnit: "mi" },
    saved,
    "ccs-rates",
  ),
  true,
);
assert.equal(
  settingsFormValuesAreDirty(
    { ...saved, distanceUnit: "mi" },
    saved,
    "delivery-customization",
  ),
  false,
);
assert.equal(
  settingsFormValuesAreDirty(
    { ...saved, weightUnit: "lb" },
    saved,
    "delivery-customization",
  ),
  true,
);

const emptyDivisor = validateBasicSettingsFormValues({
  ...saved,
  volumetricDivisor: "",
});
assert.equal(
  emptyDivisor.volumetricDivisor,
  "Enter a volumetric divisor greater than 0.",
);

const invalidFields = validateBasicSettingsFormValues({
  ...saved,
  appStatus: "",
  weightUnit: "",
  distanceUnit: "",
  dimensionUnit: "",
  multipleRates: "",
  rounding: "",
});
assert.deepEqual(Object.keys(invalidFields).sort(), [
  "appStatus",
  "dimensionUnit",
  "distanceUnit",
  "multipleRates",
  "rounding",
  "weightUnit",
]);

const formData = new FormData();
for (const [key, value] of Object.entries({
  ...saved,
  appStatus: "disabled",
  weightUnit: "lb",
  distanceUnit: "mi",
  dimensionUnit: "in",
  volumetricDivisor: "139",
  multipleRates: "lowest",
  rounding: "nearest-half",
})) {
  formData.set(key, value);
}
const parsed = parseBasicSettingsFormData(formData);
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.deepEqual(parsed.value, {
    appEnabled: false,
    weightUnit: "lb",
    distanceUnit: "mi",
    dimensionUnit: "in",
    volumetricDivisor: 139,
    multipleRates: "lowest",
    rounding: "nearest-half",
  });
}

const deliveryForm = new FormData();
deliveryForm.set("appStatus", "enabled");
deliveryForm.set("weightUnit", "oz");
const deliveryParsed = parseDeliverySettingsFormData(deliveryForm);
assert.equal(deliveryParsed.ok, true);
if (deliveryParsed.ok) {
  assert.deepEqual(deliveryParsed.value, {
    appEnabled: true,
    weightUnit: "oz",
  });
}

const settingsMarkup = renderToStaticMarkup(
  createElement(SettingsPageLayout, {
    children: createElement("s-paragraph", null, "Delivery settings"),
  }),
);
assert.match(settingsMarkup, /background="base"/);
assert.match(settingsMarkup, /border="base base solid"/);
assert.match(settingsMarkup, /padding="large"/);
assert.match(settingsMarkup, /gap="base"/);
assert.match(settingsMarkup, /Delivery settings/);

console.log("M2 settings validation and dirty-state checks passed.");
