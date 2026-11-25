import { spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const origin = new URL(process.env.SHOPIFY_APP_URL || "https://d5.genieapps.xyz");
const port = Number(process.env.APP_PORT || 3013);
if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/` ||
    origin.username || origin.password || origin.port) {
  throw new Error("SHOPIFY_APP_URL must be an HTTPS origin without a path or port.");
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("APP_PORT must be an unprivileged TCP port.");
}

const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("Set POSTGRES_PASSWORD in the ShipFlow .env file.");

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
}).catch((error) => {
  if (error.code === "EADDRINUSE") {
    throw new Error(`Port ${port} is already in use. Stop the existing ShipFlow process or choose a free port and update the tunnel route.`);
  }
  throw error;
});

const env = {
  ...process.env,
  APP_PORT: String(port),
  SHOPIFY_APP_URL: origin.origin,
  DATABASE_URL: `postgresql://shipflow:${encodeURIComponent(password)}@127.0.0.1:5433/shipflow`,
};

function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? (result.signal === "SIGINT" ? 130 : 1));
}

const databaseListening = await new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port: 5433 });
  socket.once("connect", () => {
    socket.end();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});
if (!databaseListening) run("docker", ["compose", "up", "-d", "--wait", "db"]);
else console.log("Using the existing ShipFlow database connection on port 5433.");
run("npm", ["exec", "--", "prisma", "migrate", "deploy"]);
run("npm", ["exec", "--", "prisma", "generate"]);
console.log(`ShipFlow preview uses ${origin.origin} → 127.0.0.1:${port}.`);
run("shopify", ["app", "dev", `--tunnel-url=${origin.origin}:${port}`, ...process.argv.slice(2)]);
