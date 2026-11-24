import assert from "node:assert/strict";

import { resolveShopifyAppUrl } from "../app/app-url.server";

assert.equal(
  resolveShopifyAppUrl({
    HOST: "https://shipflow-dev.trycloudflare.com",
  }),
  "https://shipflow-dev.trycloudflare.com",
  "Shopify CLI's HOST value should configure the embedded app URL",
);

assert.equal(
  resolveShopifyAppUrl({
    HOST: "https://shipflow-dev.trycloudflare.com",
    SHOPIFY_APP_URL: "https://shipflow.example.com",
  }),
  "https://shipflow.example.com",
  "an explicit deployment URL should take precedence over the CLI fallback",
);

console.log("app URL resolution tests passed");
