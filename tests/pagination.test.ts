import assert from "node:assert/strict";

import {
  clampIndexPage,
  INDEX_PAGE_SIZE,
  indexPageCount,
} from "../app/pagination";

assert.equal(INDEX_PAGE_SIZE, 10);
assert.equal(indexPageCount(0), 1);
assert.equal(indexPageCount(10), 1);
assert.equal(indexPageCount(11), 2);
assert.equal(clampIndexPage(3, 11), 2);
assert.equal(clampIndexPage(0, 11), 1);
assert.equal(clampIndexPage(Number.NaN, 11), 1);

console.log("pagination helper tests passed");
