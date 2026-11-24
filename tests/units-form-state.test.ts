import assert from "node:assert/strict";

import {
  unitFormValuesAreDirty,
  unitFormValuesFromSettings,
  validateUnitFormValues,
} from "../app/models/unit-form";
import { parseUnits } from "../app/models/shop-settings.server";

const savedSettings = {
  weightUnit: "kg" as const,
  distanceUnit: "km" as const,
  dimensionUnit: "cm" as const,
  volumetricDivisor: 5000,
};

const initial = unitFormValuesFromSettings(savedSettings);
assert.equal(initial.weightUnit, "kg");
assert.equal(initial.volumetricDivisor, "5000");
assert.equal(unitFormValuesAreDirty(initial, initial), false);
console.log("1/5 initial saved values passed");

const changed = { ...initial, weightUnit: "g" };
assert.equal(unitFormValuesAreDirty(changed, initial), true);
console.log("2/5 changed values become dirty passed");

const cleared = { ...changed, volumetricDivisor: "" };
assert.equal(unitFormValuesAreDirty(cleared, initial), true);
assert.equal(
  validateUnitFormValues(cleared).volumetricDivisor,
  "Enter a volumetric divisor greater than 0.",
);
console.log("3/5 cleared required value remains dirty passed");

const discarded = unitFormValuesFromSettings(savedSettings);
assert.deepEqual(discarded, initial);
assert.equal(discarded.weightUnit, "kg");
assert.equal(discarded.volumetricDivisor, "5000");
console.log("4/5 discard snapshot restoration passed");

const emptyForm = new FormData();
emptyForm.set("weightUnit", "");
emptyForm.set("distanceUnit", "");
emptyForm.set("dimensionUnit", "");
emptyForm.set("volumetricDivisor", "");
const invalid = parseUnits(emptyForm);
assert.equal(invalid.ok, false);
if (!invalid.ok) {
  assert.equal(invalid.fields.weightUnit, "Choose a weight unit.");
  assert.equal(invalid.fields.distanceUnit, "Choose a distance unit.");
  assert.equal(invalid.fields.dimensionUnit, "Choose a dimension unit.");
  assert.equal(
    invalid.fields.volumetricDivisor,
    "Enter a volumetric divisor greater than 0.",
  );
}
console.log("5/5 all required values reject empty input passed");
