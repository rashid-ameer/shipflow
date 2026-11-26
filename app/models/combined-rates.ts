import type { CheckoutRate } from "./checkout-decision";
import { textList, textValue } from "./checkout-values";
import { deliveryDays, validateRateCode } from "./checkout-settings";

export const combinedPaths = {
  list: "/app/rates/combined",
  editor: (id: string) => `/app/rates/combined/${id}`,
};
export const combinationMethods = {
  sum: "Sum",
  average: "Average",
  highest: "Highest",
  lowest: "Lowest",
} as const;
type Method = keyof typeof combinationMethods;
export type CombinedRule = {
  id: string;
  name: string;
  active: boolean;
  description: string;
  notes: string;
  minDays: number | null;
  maxDays: number | null;
  serviceCode?: string | null;
  method: Method;
  requirement: "any" | "all";
  tags: string[];
  requireTwoTags: boolean;
  excludedTags: string[];
  blockingTags: string[];
  useWinningName: boolean;
  outputTag: string;
};
export type CombinedDraft = Omit<
  CombinedRule,
  "id" | "tags" | "excludedTags" | "blockingTags" | "minDays" | "maxDays"
> & {
  tags: string;
  excludedTags: string;
  blockingTags: string;
  minDays: string;
  maxDays: string;
};
export const emptyCombinedDraft: CombinedDraft = {
  name: "",
  active: false,
  description: "",
  notes: "",
  minDays: "",
  maxDays: "",
  method: "sum",
  requirement: "all",
  tags: "",
  requireTwoTags: false,
  excludedTags: "",
  blockingTags: "",
  useWinningName: false,
  outputTag: "",
};

export function combinedDraft(rule: CombinedRule): CombinedDraft {
  const {
    id: _id,
    tags,
    excludedTags,
    blockingTags,
    minDays,
    maxDays,
    ...fields
  } = rule;
  return {
    ...fields,
    tags: tags.join(", "),
    excludedTags: excludedTags.join(", "),
    blockingTags: blockingTags.join(", "),
    minDays: minDays === null ? "" : String(minDays),
    maxDays: maxDays === null ? "" : String(maxDays),
  };
}

function readTags(input: unknown) {
  const tags = new Map<string, string>();
  for (const tag of textList(textValue(input))) {
    if (tag.length > 60) throw new Error("Use up to 60 characters per tag.");
    const key = tag.toLowerCase();
    if (!tags.has(key)) tags.set(key, tag);
  }
  if (tags.size > 30) throw new Error("Use up to 30 tags per list.");
  return [...tags.values()];
}

export function validateCombinedDraft(
  input: unknown,
): Omit<CombinedRule, "id"> {
  const draft = input as Partial<CombinedDraft> | null;
  const name = textValue(draft?.name);
  if (!name || name.length > 120)
    throw new Error("Enter a shipping rate name of 1 to 120 characters.");
  if (
    !draft ||
    typeof draft.active !== "boolean" ||
    !Object.hasOwn(combinationMethods, draft.method ?? "") ||
    (draft.requirement !== "any" && draft.requirement !== "all")
  )
    throw new Error("Choose a valid calculation, status, and tag requirement.");
  const method = draft.method!;
  const tags = readTags(draft.tags);
  if (!tags.length)
    throw new Error("Enter at least one shipping tag to combine.");
  if (draft.requireTwoTags && tags.length < 2)
    throw new Error("Enter at least two distinct shipping tags.");
  const description = textValue(draft.description);
  const notes = textValue(draft.notes);
  if (description.length > 250 || notes.length > 1000)
    throw new Error(
      "Use up to 250 characters for the description and 1,000 for notes.",
    );
  const outputTag = textValue(draft.outputTag);
  if (outputTag.includes(",") || outputTag.length > 60)
    throw new Error("Enter one output tag up to 60 characters.");
  const minDays = deliveryDays(draft.minDays);
  const maxDays = deliveryDays(draft.maxDays);
  if (minDays !== null && maxDays !== null && maxDays < minDays)
    throw new Error("Latest delivery must be on or after earliest delivery.");
  return {
    name,
    description,
    notes,
    minDays,
    maxDays,
    serviceCode: validateRateCode(draft.serviceCode),
    method,
    tags,
    active: draft.active,
    requirement: draft.requirement,
    outputTag,
    requireTwoTags: draft.requireTwoTags === true,
    excludedTags: readTags(draft.excludedTags),
    blockingTags: readTags(draft.blockingTags),
    useWinningName:
      (method === "highest" || method === "lowest") &&
      draft.useWinningName === true,
  };
}

export type CombinableRate = CheckoutRate & { name: string; tags: string[] };
type SkipReason =
  "missing-tags" | "two-tags" | "blocked" | "excluded" | "amount-limit";
type CombinedStep = {
  ruleId: string;
  ruleName: string;
  method: Method;
  sources: { id: string; name: string; amount: number }[];
} & (
  | { reason: SkipReason; tags?: string[] }
  | { resultId: string; name: string; amount: number }
);
export type CombinationTrace = CombinedStep & { currency: string };

export function combineShippingRates(
  sourceRates: CombinableRate[],
  rules: CombinedRule[],
) {
  let rates = sourceRates;
  const steps: CombinedStep[] = [];
  for (const rule of rules) {
    if (!rule.active || !rule.tags.length) continue;
    const normalized = new Map(
      rates.map((rate) => [
        rate.id,
        rate.tags.map((tag) => tag.trim().toLowerCase()),
      ]),
    );
    const includes = (rate: CombinableRate, tags: string[]) =>
      normalized.get(rate.id)!.some((tag) => tags.includes(tag));
    const candidates = rates.filter((rate) =>
      includes(
        rate,
        rule.tags.map((tag) => tag.toLowerCase()),
      ),
    );
    const required = new Set(rule.tags.map((tag) => tag.toLowerCase()));
    const present = new Set(
      candidates
        .flatMap((rate) => normalized.get(rate.id)!)
        .filter((tag) => required.has(tag)),
    );
    const excluded = rule.excludedTags.map((tag) => tag.toLowerCase());
    const sources = candidates.filter((rate) => !includes(rate, excluded));
    const blocked = rule.blockingTags.filter((tag) =>
      rates.some((rate) => includes(rate, [tag.toLowerCase()])),
    );
    const missing = rule.tags.filter((tag) => !present.has(tag.toLowerCase()));
    const step = {
      ruleId: rule.id,
      ruleName: rule.name,
      method: rule.method,
      sources: sources.map(({ id, name, amountInMinorUnits }) => ({
        id,
        name,
        amount: amountInMinorUnits,
      })),
    };
    if (blocked.length) {
      steps.push({ ...step, reason: "blocked", tags: blocked });
      continue;
    }
    if (!candidates.length || (rule.requirement === "all" && missing.length)) {
      steps.push({ ...step, reason: "missing-tags", tags: missing });
      continue;
    }
    if (rule.requireTwoTags && present.size < 2) {
      steps.push({ ...step, reason: "two-tags" });
      continue;
    }
    if (!sources.length) {
      steps.push({ ...step, reason: "excluded" });
      continue;
    }
    const winner =
      rule.method === "highest" || rule.method === "lowest"
        ? sources.reduce((best, rate) => {
            const diff = rate.amountInMinorUnits - best.amountInMinorUnits;
            return (rule.method === "highest" ? diff > 0 : diff < 0)
              ? rate
              : best;
          })
        : null;
    const sum = sources.reduce(
      (total, rate) => total + BigInt(rate.amountInMinorUnits),
      0n,
    );
    const count = BigInt(sources.length);
    const amount =
      winner?.amountInMinorUnits ??
      Number(rule.method === "average" ? (sum + count / 2n) / count : sum);
    if (!Number.isSafeInteger(amount) || amount > 2_000_000_000) {
      steps.push({ ...step, reason: "amount-limit" });
      continue;
    }
    const result: CombinableRate = {
      id: `combined-${rule.id}`,
      name: rule.useWinningName && winner ? winner.name : rule.name,
      amountInMinorUnits: amount,
      priority: Math.min(
        ...sources.map((rate) => rate.priority ?? Number.MAX_SAFE_INTEGER),
      ),
      tags: rule.outputTag ? [rule.outputTag] : [],
    };
    const consumed = new Set(sources.map((rate) => rate.id));
    const first = sources[0].id;
    rates = rates.flatMap((rate) =>
      rate.id === first ? [result] : consumed.has(rate.id) ? [] : [rate],
    );
    steps.push({ ...step, resultId: result.id, name: result.name, amount });
  }
  return { rates, steps };
}
