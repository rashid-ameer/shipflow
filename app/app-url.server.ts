type AppUrlEnvironment = {
  HOST?: string;
  SHOPIFY_APP_URL?: string;
};

/**
 * Production deployments provide SHOPIFY_APP_URL. Shopify CLI provides the
 * current development tunnel as HOST, so local embedded auth must fall back to
 * that value instead of persisting a tunnel URL in .env.
 */
export function resolveShopifyAppUrl(env: AppUrlEnvironment): string {
  return env.SHOPIFY_APP_URL?.trim() || env.HOST?.trim() || "";
}
