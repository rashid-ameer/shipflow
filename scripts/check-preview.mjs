import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const origin = process.argv[2] || process.env.SHOPIFY_APP_URL || "https://d5.genieapps.xyz";
const endpoint = new URL("/health", origin);

try {
  const response = await fetch(endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const health = await response.json();
  if (health.app !== "shipflow" || health.status !== "ok") {
    throw new Error("Response did not identify a ready ShipFlow app");
  }
  console.log(`ShipFlow is ready at ${endpoint.origin}`);
} catch (error) {
  console.error(`ShipFlow did not respond at ${endpoint.href}: ${error.message}`);
  process.exitCode = 1;
}
