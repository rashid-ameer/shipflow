export const DELIVERY_LIMIT = 25;
export const MAX_CONDITIONS = 20;
export const MAX_ACTIONS = 10;

export const deliveryCheckoutStatus = {
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  "out-of-sync": { label: "Needs sync", tone: "warning" },
  unavailable: { label: "Status unavailable", tone: "warning" },
} as const;

export const deliveryMethods = {
  SHIPPING: "Shipping",
  LOCAL: "Local delivery",
  PICK_UP: "Pickup in store",
  PICKUP_POINT: "Pickup point",
} as const;

export const actions = {
  "hide-specific": "Hide specific rates",
  "hide-all": "Hide all rates",
  "show-specific": "Show specific rates",
  "show-all": "Show all rates",
  message: "Append message to a shipping rate title",
  rename: "Rename a shipping rate",
  reorder: "Move a rate to a position",
  top: "Move a rate to the top",
  bottom: "Move a rate to the bottom",
  cheapest: "Show only the cheapest rate",
  highest: "Show only the highest rate",
} as const;

export const operators = {
  equals: "Equals",
  "not-equals": "Does not equal",
  contains: "Contains",
  "starts-with": "Starts with",
  "ends-with": "Ends with",
  atLeast: "At least",
  atMost: "At most",
  between: "Between",
} as const;

const numeric = [
  "equals",
  "not-equals",
  "atLeast",
  "atMost",
  "between",
] as const;
const identity = ["equals", "not-equals"] as const;
export const nameOperators = [
  "equals",
  "contains",
  "starts-with",
  "ends-with",
] as const;

type Scope = "basic" | "advanced";
type Field = {
  label: string;
  category: "Cart" | "Product" | "Customer" | "Store time";
  scopes: readonly Scope[];
  operators: readonly (keyof typeof operators)[];
  input?: "number" | "date" | "time" | "boolean" | "purchase" | "collection";
  key?: boolean;
};

const basic = ["basic"] as const;
const advanced = ["advanced"] as const;
const both = ["basic", "advanced"] as const;
export const conditionFields = {
  total: {
    label: "Cart total",
    category: "Cart",
    scopes: basic,
    operators: numeric,
    input: "number",
  },
  subtotal: {
    label: "Subtotal",
    category: "Cart",
    scopes: basic,
    operators: numeric,
    input: "number",
  },
  discount: {
    label: "Total discount",
    category: "Cart",
    scopes: basic,
    operators: numeric,
    input: "number",
  },
  quantity: {
    label: "Item quantity",
    category: "Cart",
    scopes: both,
    operators: numeric,
    input: "number",
  },
  weight: {
    label: "Cart weight",
    category: "Cart",
    scopes: basic,
    operators: numeric,
    input: "number",
  },
  zip: {
    label: "Postal code",
    category: "Cart",
    scopes: both,
    operators: [...nameOperators, "not-equals"],
  },
  cartAttribute: {
    label: "Cart attribute",
    category: "Cart",
    scopes: advanced,
    operators: [...nameOperators, "not-equals"],
    key: true,
  },
  sku: {
    label: "SKU",
    category: "Product",
    scopes: basic,
    operators: [...nameOperators, "not-equals"],
  },
  productQuantity: {
    label: "Quantity for one SKU",
    category: "Product",
    scopes: basic,
    operators: numeric,
    input: "number",
    key: true,
  },
  productTag: {
    label: "Product tag",
    category: "Product",
    scopes: basic,
    operators: identity,
  },
  vendor: {
    label: "Vendor",
    category: "Product",
    scopes: advanced,
    operators: [...nameOperators, "not-equals"],
  },
  productType: {
    label: "Product type",
    category: "Product",
    scopes: advanced,
    operators: [...nameOperators, "not-equals"],
  },
  collection: {
    label: "Collection ID",
    category: "Product",
    scopes: advanced,
    operators: identity,
    input: "collection",
  },
  lineAttribute: {
    label: "Line item property",
    category: "Product",
    scopes: advanced,
    operators: [...nameOperators, "not-equals"],
    key: true,
  },
  purchaseType: {
    label: "Purchase type",
    category: "Product",
    scopes: advanced,
    operators: identity,
    input: "purchase",
  },
  country: {
    label: "Delivery country code",
    category: "Customer",
    scopes: basic,
    operators: identity,
  },
  province: {
    label: "Delivery province code",
    category: "Customer",
    scopes: basic,
    operators: identity,
  },
  customerTag: {
    label: "Customer tag",
    category: "Customer",
    scopes: basic,
    operators: identity,
  },
  authenticated: {
    label: "Signed in",
    category: "Customer",
    scopes: advanced,
    operators: ["equals"],
    input: "boolean",
  },
  orders: {
    label: "Previous orders",
    category: "Customer",
    scopes: advanced,
    operators: numeric,
    input: "number",
  },
  b2b: {
    label: "Buying for a company",
    category: "Customer",
    scopes: advanced,
    operators: ["equals"],
    input: "boolean",
  },
  date: {
    label: "Store date",
    category: "Store time",
    scopes: advanced,
    operators: numeric,
    input: "date",
  },
  time: {
    label: "Store time",
    category: "Store time",
    scopes: advanced,
    operators: ["between"],
    input: "time",
  },
} as const satisfies Record<string, Field>;

type Method = keyof typeof deliveryMethods;
type ActionKind = keyof typeof actions;
type ConditionField = keyof typeof conditionFields;
type Operator = keyof typeof operators;
type WeightUnit = "g" | "kg" | "lb" | "oz";

export type Condition = {
  field: ConditionField;
  operator: Operator;
  value: string;
  upper?: string;
  key?: string;
};

export type DeliveryAction = {
  kind: ActionKind;
  operator?: (typeof nameOperators)[number];
  match?: string;
  text?: string;
  position?: number;
};

export type DeliveryRule = {
  name: string;
  active: boolean;
  scope: Scope;
  methods: Method[];
  conditions: Condition[];
  ifActions: DeliveryAction[];
  elseActions: DeliveryAction[];
  weightUnit: WeightUnit;
};

export const deliveryPaths = {
  list: "/app/delivery-customizations",
  create: "/app/delivery-customizations/new",
  edit: (id: string) => `/app/delivery-customizations/${id}`,
} as const;

export const configurationKey = "delivery-rule";
export const configurationNamespace = "$app:shipflow";
export const functionHandles: Record<Scope, string> = {
  basic: "shipflow-delivery-customization",
  advanced: "shipflow-delivery-advanced",
};

export function emptyDeliveryRule(weightUnit: string): DeliveryRule {
  return {
    name: "",
    active: true,
    scope: "basic",
    methods: ["SHIPPING"],
    conditions: [],
    ifActions: [],
    elseActions: [],
    weightUnit:
      weightUnit === "g" || weightUnit === "lb" || weightUnit === "oz"
        ? weightUnit
        : "kg",
  };
}

export function hasRateMatcher(kind: ActionKind) {
  return [
    "hide-specific",
    "show-specific",
    "message",
    "rename",
    "reorder",
    "top",
    "bottom",
  ].includes(kind);
}

export function shippingTitleAction(kind: ActionKind) {
  return kind === "message" || kind === "rename";
}

export function fieldDetails(field: ConditionField): Field {
  return conditionFields[field];
}

export function validateDeliveryRule(
  candidate: unknown,
): { ok: true; rule: DeliveryRule } | { ok: false; error: string } {
  const invalid = (error: string) => ({ ok: false as const, error });
  if (!candidate || typeof candidate !== "object")
    return invalid("Enter the customization details.");
  const draft = candidate as DeliveryRule;
  if (
    typeof draft.name !== "string" ||
    !draft.name.trim() ||
    draft.name.trim().length > 120
  ) {
    return invalid("Enter a customization name of 1 to 120 characters.");
  }
  if (
    (draft.scope !== "basic" && draft.scope !== "advanced") ||
    typeof draft.active !== "boolean" ||
    !["g", "kg", "lb", "oz"].includes(draft.weightUnit)
  ) {
    return invalid("Choose a valid data scope, weight unit and status.");
  }
  if (
    !Array.isArray(draft.methods) ||
    draft.methods.length < 1 ||
    new Set(draft.methods).size !== draft.methods.length ||
    draft.methods.some((method) => !Object.hasOwn(deliveryMethods, method))
  ) {
    return invalid("Choose at least one delivery method type.");
  }
  if (
    !Array.isArray(draft.conditions) ||
    draft.conditions.length > MAX_CONDITIONS
  ) {
    return invalid(`Use up to ${MAX_CONDITIONS} conditions.`);
  }

  const conditions: Condition[] = [];
  for (const item of draft.conditions) {
    if (!item || !Object.hasOwn(conditionFields, item.field))
      return invalid("Choose a condition field.");
    const field = fieldDetails(item.field);
    if (
      !field.scopes.includes(draft.scope) ||
      !field.operators.includes(item.operator)
    ) {
      return invalid(
        `Choose a supported operator and scope for ${field.label}.`,
      );
    }
    const value = clean(item.value, 120);
    const upper =
      item.operator === "between" ? clean(item.upper, 120) : undefined;
    const key = field.key ? clean(item.key, 80) : undefined;
    if (
      !value ||
      (field.key && !key) ||
      !validValue(field.input, value) ||
      (item.operator === "between" &&
        (!upper ||
          !validValue(field.input, upper) ||
          (field.input === "number"
            ? Number(value) > Number(upper)
            : value > upper)))
    ) {
      return invalid(`Enter a valid value for ${field.label}.`);
    }
    conditions.push({
      field: item.field,
      operator: item.operator,
      value: normalizeValue(field.input, value),
      ...(upper ? { upper } : {}),
      ...(key ? { key } : {}),
    });
  }
  for (const field of ["cartAttribute", "lineAttribute", "time"] as const) {
    const matching = conditions.filter(
      (condition) => condition.field === field,
    );
    if (
      field === "time"
        ? matching.length > 1
        : new Set(matching.map((condition) => condition.key)).size > 1
    ) {
      return invalid(
        `Use one ${fieldDetails(field).label.toLowerCase()} ${field === "time" ? "range" : "key"} per customization.`,
      );
    }
  }

  if (
    !Array.isArray(draft.ifActions) ||
    draft.ifActions.length < 1 ||
    !Array.isArray(draft.elseActions)
  )
    return invalid("Add an action to the IF branch.");
  if (
    draft.ifActions.length > MAX_ACTIONS ||
    draft.elseActions.length > MAX_ACTIONS
  ) {
    return invalid(`Use up to ${MAX_ACTIONS} actions in each branch.`);
  }
  if (conditions.length === 0 && draft.elseActions.length > 0) {
    return invalid("Add a condition before using ELSE actions.");
  }
  const branches: DeliveryAction[][] = [];
  for (const branch of [draft.ifActions, draft.elseActions]) {
    const normalized: DeliveryAction[] = [];
    for (const item of branch) {
      if (!item || !Object.hasOwn(actions, item.kind))
        return invalid("Choose a valid action.");
      const action: DeliveryAction = { kind: item.kind };
      if (hasRateMatcher(item.kind)) {
        const match = clean(item.match, 120);
        if (
          !match ||
          !item.operator ||
          !nameOperators.includes(item.operator)
        ) {
          return invalid(
            `Enter a rate name match for “${actions[item.kind]}”.`,
          );
        }
        action.match = match;
        action.operator = item.operator;
      }
      if (shippingTitleAction(item.kind)) {
        if (!draft.methods.includes("SHIPPING"))
          return invalid(
            "Select Shipping to rename a rate or append a message.",
          );
        const title = clean(item.text, 100);
        if (!title) return invalid("Enter the new shipping title or message.");
        action.text = title;
      }
      if (item.kind === "reorder") {
        if (
          !Number.isInteger(item.position) ||
          item.position! < 0 ||
          item.position! > 99
        ) {
          return invalid("Enter a rate position from 0 to 99.");
        }
        action.position = item.position;
      }
      normalized.push(action);
    }
    branches.push(normalized);
  }
  return {
    ok: true,
    rule: {
      name: draft.name.trim(),
      active: draft.active,
      scope: draft.scope,
      weightUnit: draft.weightUnit,
      methods: [...draft.methods],
      conditions,
      ifActions: branches[0],
      elseActions: branches[1],
    },
  };
}

function clean(value: unknown, limit: number) {
  return typeof value === "string" && value.trim().length <= limit
    ? value.trim()
    : "";
}

function validValue(input: Field["input"], value: string) {
  switch (input) {
    case "number":
      return /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value));
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return (
        Number.isFinite(date.valueOf()) &&
        date.toISOString().slice(0, 10) === value
      );
    }
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    case "boolean":
      return value === "true" || value === "false";
    case "purchase":
      return value === "one-time" || value === "subscription";
    case "collection":
      return /^(gid:\/\/shopify\/Collection\/)?[1-9]\d*$/.test(value);
    default:
      return true;
  }
}

function normalizeValue(input: Field["input"], value: string) {
  return input === "collection" && !value.startsWith("gid:")
    ? `gid://shopify/Collection/${value}`
    : value;
}
