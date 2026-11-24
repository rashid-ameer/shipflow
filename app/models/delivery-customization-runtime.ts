import type { Condition, DeliveryRule } from "./delivery-customization";

type Money = { amount: string | number };
type Tag = { tag: string; hasTag: boolean };
type Product = {
  hasTags?: Tag[];
  vendor?: string | null;
  productType?: string | null;
  inCollections?: { collectionId: string; isMember: boolean }[];
};
type Merchandise = {
  __typename: string;
  sku?: string | null;
  weight?: number | null;
  weightUnit?: string;
  product?: Product;
};
type Line = {
  quantity: number;
  merchandise: Merchandise;
  attribute?: { value?: string | null } | null;
  sellingPlanAllocation?: { sellingPlan: { id: string } } | null;
};
type Option = {
  handle: string;
  title?: string | null;
  deliveryMethodType: string;
  cost: Money;
};
type Group = {
  deliveryAddress?: {
    zip?: string | null;
    countryCode?: string | null;
    provinceCode?: string | null;
  } | null;
  deliveryOptions: Option[];
};
export type DeliveryFunctionInput = {
  deliveryCustomization: { metafield?: { jsonValue: unknown } | null };
  shop?: { localTime: { date: string; inWindow: boolean } };
  cart: {
    cost?: { subtotalAmount: Money; totalAmount: Money };
    discountApplications?: { totalAllocatedAmount: Money }[];
    attribute?: { value?: string | null } | null;
    buyerIdentity?: {
      isAuthenticated?: boolean;
      purchasingCompany?: { company: { id: string } } | null;
      customer?: { hasTags?: Tag[]; numberOfOrders?: number } | null;
    } | null;
    lines: Line[];
    deliveryGroups: Group[];
  };
};

export type DeliveryConfiguration = {
  version: 1;
  ruleId: string;
  revision: string;
  rule: DeliveryRule;
  productTags?: string[];
  customerTags?: string[];
  collections?: string[];
  cartKey?: string;
  lineKey?: string;
  start?: string;
  end?: string;
};

type Operation =
  | { deliveryOptionHide: { deliveryOptionHandle: string } }
  | { deliveryOptionRename: { deliveryOptionHandle: string; title: string } }
  | { deliveryOptionMove: { deliveryOptionHandle: string; index: number } };

export function deliveryOperations(input: DeliveryFunctionInput): {
  operations: Operation[];
} {
  const configuration = input.deliveryCustomization.metafield?.jsonValue as
    DeliveryConfiguration | undefined;
  const rule = configuration?.version === 1 ? configuration.rule : undefined;
  if (
    !rule?.active ||
    !Array.isArray(rule.methods) ||
    !Array.isArray(rule.conditions) ||
    !Array.isArray(rule.ifActions) ||
    !Array.isArray(rule.elseActions)
  ) {
    return { operations: [] };
  }

  const operations: Operation[] = [];
  const cartMatches = new Map<Condition, boolean>();
  for (const group of input.cart.deliveryGroups) {
    const branch = rule.conditions.every((condition) => {
      if (["zip", "country", "province"].includes(condition.field)) {
        return matches(condition, input, group, rule);
      }
      const cached = cartMatches.get(condition);
      if (cached !== undefined) return cached;
      const matched = matches(condition, input, group, rule);
      cartMatches.set(condition, matched);
      return matched;
    })
      ? rule.ifActions
      : rule.elseActions;
    if (branch.length === 0) continue;

    const order = group.deliveryOptions.map((option) => ({
      ...option,
      originalTitle: option.title ?? "",
      title: option.title ?? "",
      hidden: false,
    }));
    const scoped = order.filter((option) =>
      rule.methods.some((method) => method === option.deliveryMethodType),
    );
    for (const action of branch) {
      const candidates = scoped.filter(
        (option) =>
          (action.kind !== "rename" && action.kind !== "message") ||
          option.deliveryMethodType === "SHIPPING",
      );
      const targets = action.match
        ? candidates.filter((option) =>
            compare(option.title, action.operator ?? "equals", action.match!),
          )
        : candidates;
      const target = targets[0];
      switch (action.kind) {
        case "hide-all":
        case "hide-specific":
          for (const option of targets) option.hidden = true;
          break;
        case "show-all":
          for (const option of scoped) option.hidden = false;
          break;
        case "show-specific":
          for (const option of scoped)
            option.hidden = !targets.includes(option);
          break;
        case "rename":
          for (const option of targets) option.title = action.text!;
          break;
        case "message":
          for (const option of targets)
            option.title = `${option.title} — ${action.text}`.slice(0, 255);
          break;
        case "top":
        case "bottom":
        case "reorder": {
          if (!target) break;
          const from = order.indexOf(target);
          const index =
            action.kind === "top"
              ? 0
              : action.kind === "bottom"
                ? order.length - 1
                : Math.min(action.position ?? 0, order.length - 1);
          if (from === index) break;
          order.splice(from, 1);
          order.splice(index, 0, target);
          operations.push({
            deliveryOptionMove: { deliveryOptionHandle: target.handle, index },
          });
          break;
        }
        case "cheapest":
        case "highest": {
          const visible = order.filter(
            (option) => !option.hidden && scoped.includes(option),
          );
          if (visible.length === 0) break;
          const best = visible.reduce((current, option) =>
            (
              action.kind === "cheapest"
                ? Number(option.cost.amount) < Number(current.cost.amount)
                : Number(option.cost.amount) > Number(current.cost.amount)
            )
              ? option
              : current,
          );
          for (const option of visible)
            if (option !== best) option.hidden = true;
          break;
        }
      }
    }
    for (const option of scoped) {
      if (option.hidden) {
        operations.push({
          deliveryOptionHide: { deliveryOptionHandle: option.handle },
        });
      } else if (option.title !== option.originalTitle) {
        operations.push({
          deliveryOptionRename: {
            deliveryOptionHandle: option.handle,
            title: option.title,
          },
        });
      }
    }
  }
  return { operations };
}

function matches(
  condition: Condition,
  input: DeliveryFunctionInput,
  group: Group,
  rule: DeliveryRule,
): boolean {
  const { cart } = input;
  const buyer = cart.buyerIdentity;
  const customer = buyer?.customer;
  const variants = () =>
    cart.lines.filter(
      (line) => line.merchandise.__typename === "ProductVariant",
    );
  const { field, operator, value, upper, key } = condition;
  const test = (actual?: string | number | null) =>
    actual != null && compare(actual, operator, value, upper);
  const any = (values: (string | null | undefined)[]) => {
    const available = values.filter((item): item is string => item != null);
    return (
      available.length > 0 &&
      (operator === "not-equals" ? available.every(test) : available.some(test))
    );
  };
  const present = (flags: boolean[]) =>
    flags.length > 0 &&
    (operator === "not-equals" ? !flags.some(Boolean) : flags.some(Boolean));
  switch (field) {
    case "total":
      return test(money(cart.cost?.totalAmount));
    case "subtotal":
      return test(money(cart.cost?.subtotalAmount));
    case "discount":
      return test(
        cart.discountApplications?.reduce(
          (sum, item) => sum + Number(item.totalAllocatedAmount.amount),
          0,
        ),
      );
    case "quantity":
      return test(cart.lines.reduce((sum, line) => sum + line.quantity, 0));
    case "weight": {
      const grams = variants().reduce(
        (sum, { merchandise, quantity }) =>
          sum +
          (merchandise.weight ?? 0) *
            gramsPerUnit(merchandise.weightUnit) *
            quantity,
        0,
      );
      return test(grams / gramsPerUnit(rule.weightUnit));
    }
    case "zip":
      return test(group.deliveryAddress?.zip);
    case "country":
      return test(group.deliveryAddress?.countryCode);
    case "province":
      return test(group.deliveryAddress?.provinceCode);
    case "sku":
      return any(variants().map(({ merchandise }) => merchandise.sku));
    case "productQuantity":
      return test(
        variants().reduce(
          (sum, line) =>
            sum +
            (line.merchandise.sku &&
            compare(line.merchandise.sku, "equals", key!)
              ? line.quantity
              : 0),
          0,
        ),
      );
    case "productTag":
      return present(
        variants().flatMap(({ merchandise }) =>
          (merchandise.product?.hasTags ?? [])
            .filter((tag) => tag.tag === value)
            .map((tag) => tag.hasTag),
        ),
      );
    case "customerTag":
      return present(
        (customer?.hasTags ?? [])
          .filter((tag) => tag.tag === value)
          .map((tag) => tag.hasTag),
      );
    case "cartAttribute":
      return test(cart.attribute?.value);
    case "lineAttribute":
      return any(cart.lines.map((line) => line.attribute?.value));
    case "vendor":
      return any(
        variants().map(({ merchandise }) => merchandise.product?.vendor),
      );
    case "productType":
      return any(
        variants().map(({ merchandise }) => merchandise.product?.productType),
      );
    case "collection":
      return present(
        variants().flatMap(({ merchandise }) =>
          (merchandise.product?.inCollections ?? [])
            .filter((item) => item.collectionId === value)
            .map((item) => item.isMember),
        ),
      );
    case "purchaseType":
      return any(
        cart.lines.map((line) =>
          line.sellingPlanAllocation?.sellingPlan.id
            ? "subscription"
            : "one-time",
        ),
      );
    case "authenticated":
      return test(buyer?.isAuthenticated === true ? "true" : "false");
    case "orders":
      return test(customer?.numberOfOrders);
    case "b2b":
      return test(buyer?.purchasingCompany?.company.id ? "true" : "false");
    case "date":
      return test(input.shop?.localTime.date);
    case "time":
      return input.shop?.localTime.inWindow === true;
  }
}

function compare(
  actual: string | number,
  operator: Condition["operator"],
  value: string,
  upper?: string,
) {
  const left =
    typeof actual === "number" ? actual : actual.trim().toLowerCase();
  const right =
    typeof actual === "number" ? Number(value) : value.toLowerCase();
  switch (operator) {
    case "equals":
      return left === right;
    case "not-equals":
      return left !== right;
    case "atLeast":
      return left >= right;
    case "atMost":
      return left <= right;
    case "between":
      return (
        left >= right &&
        upper != null &&
        left <= (typeof actual === "number" ? Number(upper) : upper)
      );
    case "contains":
      return String(left).includes(String(right));
    case "starts-with":
      return String(left).startsWith(String(right));
    case "ends-with":
      return String(left).endsWith(String(right));
  }
}

function money(value?: Money) {
  return value == null ? undefined : Number(value.amount);
}

function gramsPerUnit(unit?: string) {
  switch (unit) {
    case "kg":
    case "KILOGRAMS":
      return 1000;
    case "lb":
    case "POUNDS":
      return 453.59237;
    case "oz":
    case "OUNCES":
      return 28.349523125;
    default:
      return 1;
  }
}
