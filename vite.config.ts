import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";

// Shopify CLI supplies HOST for its proxy. Vite uses HOST for its own bind
// address, so keep the public origin in the variable used by the app instead.
if (process.env.HOST) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const appHost = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT || 5173),
    allowedHosts: [appHost],
    hmr: appHost === "localhost"
      ? undefined
      : { protocol: "wss", host: appHost, clientPort: 443 },
  },
  plugins: [reactRouter()],
});
