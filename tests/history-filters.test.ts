import assert from "node:assert/strict";

import {
  historyFilterParams,
  historyFilters,
  parseHistoryRange,
} from "../app/models/checkout-history";

const params = historyFilterParams({
  search: "  Acme  ",
  from: "2026-11-20",
  to: "2026-11-25",
  page: 2,
});

assert.equal(params.get("q"), "Acme");
assert.equal(params.get("from"), "2026-11-20");
assert.equal(params.get("to"), "2026-11-25");
assert.equal(params.get("page"), "2");

const filters = historyFilters(params, new Date("2026-11-25T12:00:00Z"));
assert.equal(filters.search, "Acme");
assert.equal(filters.from, "2026-11-20");
assert.equal(filters.to, "2026-11-25");
assert.equal(filters.page, 2);

assert.deepEqual(parseHistoryRange("2026-11-20--"), {
  from: "2026-11-20",
  to: "",
  complete: false,
});
assert.deepEqual(parseHistoryRange("2026-11-20--2026-11-25"), {
  from: "2026-11-20",
  to: "2026-11-25",
  complete: true,
});

console.log("history filter state tests passed");
