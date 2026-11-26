import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import prisma from "../db.server";
import type { CarrierCart, FixedRate } from "./calculated-rates";
import { parseMoney, textValue, weightGrams } from "./checkout-values";
import {
  dimensionAxes,
  dimensionInCm,
  dimensionalFactor,
  lineVolume,
} from "./product-dimensions";
import { packByDimensions } from "./package-pricing";
import type {
  CarrierQuoteResult,
  CarrierService,
  LiveCarrierRate,
} from "./live-carrier";
import {
  CarrierFailure,
  quoteUps,
  type Parcel,
  type ShipAddress,
  type UpsCredentials,
} from "./ups-rating.server";

type Lane = "domestic" | "international";
type Services = Record<Lane, CarrierService[]>;
const emptyServices: Services = { domestic: [], international: [] };
type TestRoute = { origin: ShipAddress; destination: ShipAddress };
type ConnectionDetails = {
  auth: UpsCredentials;
  routes: Partial<Record<Lane, TestRoute>>;
};

const laneFor = (origin: ShipAddress, destination: ShipAddress): Lane =>
  origin.country === destination.country ? "domestic" : "international";

function encryptionKey() {
  const key = process.env.SHIPFLOW_CARRIER_KEY ?? "";
  if (!/^[\da-f]{64}$/i.test(key))
    throw new CarrierFailure(
      "Carrier credential storage is unavailable. Set SHIPFLOW_CARRIER_KEY to a 32-byte hex key.",
    );
  return Buffer.from(key, "hex");
}

function encrypt(details: ConnectionDetails, storeId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`ups:${storeId}`));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(details)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decrypt(value: string, storeId: string): ConnectionDetails {
  try {
    const [iv, tag, body] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`ups:${storeId}`));
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([cipher.update(body), cipher.final()]).toString(),
    );
  } catch {
    throw new CarrierFailure(
      "UPS credentials could not be read. Reconnect the carrier.",
    );
  }
}

export async function getUpsConnection(storeId: string) {
  const row = await prisma.carrierConnection.findUnique({
    where: { storeId_carrier: { storeId, carrier: "ups" } },
    select: { services: true, syncedAt: true, error: true, revision: true },
  });
  return (
    row && {
      ...row,
      services: row.services as Services,
      syncedAt: row.syncedAt?.toISOString() ?? null,
    }
  );
}

function readAddress(form: FormData, prefix: string): ShipAddress {
  const country = textValue(form.get(prefix + "Country")).toUpperCase();
  const postalCode = textValue(form.get(prefix + "Postal"));
  const province = textValue(form.get(prefix + "Province")).toUpperCase();
  if (
    !/^[A-Z]{2}$/.test(country) ||
    !/^[a-z0-9][a-z0-9 -]{0,15}$/i.test(postalCode) ||
    (province && !/^[A-Z0-9-]{1,8}$/.test(province))
  )
    throw new CarrierFailure(
      "Enter a valid test country, postal code, and state or province code.",
    );
  return { country, postalCode, province };
}

export async function changeUpsConnection(storeId: string, form: FormData) {
  const where = { storeId, carrier: "ups" };
  const row = await prisma.carrierConnection.findUnique({
    where: { storeId_carrier: where },
  });
  if ((row?.revision ?? "") !== textValue(form.get("revision")))
    throw new CarrierFailure(
      "The carrier connection changed. Refresh Settings and try again.",
    );
  if (form.get("intent") === "carrier-disconnect") {
    const removed = await prisma.carrierConnection.deleteMany({
      where: { ...where, revision: row?.revision ?? "" },
    });
    if (row && !removed.count)
      throw new CarrierFailure(
        "The carrier connection changed. Refresh Settings and try again.",
      );
    return "UPS disconnected.";
  }
  const sync = form.get("intent") === "carrier-sync";
  const connect = form.get("intent") === "carrier-connect";
  if (!connect && !row)
    throw new CarrierFailure("Connect UPS before syncing services.");
  const saved = row && !connect ? decrypt(row.credentials, storeId) : undefined;
  const environment = textValue(form.get("environment"));
  const account = textValue(form.get("account"));
  const clientId = textValue(form.get("clientId"));
  const clientSecret = textValue(form.get("clientSecret"));
  if (
    !saved &&
    (!["sandbox", "production"].includes(environment) ||
      !/^[a-z0-9]{6}$/i.test(account) ||
      !clientId ||
      clientId.includes(":") ||
      !clientSecret ||
      clientId.length > 512 ||
      clientSecret.length > 512)
  )
    throw new CarrierFailure(
      "Enter the UPS account number, client ID, and client secret.",
    );
  const details: ConnectionDetails = {
    auth: saved?.auth ?? {
      account,
      clientId,
      clientSecret,
      environment: environment as UpsCredentials["environment"],
    },
    routes: { ...saved?.routes },
  };
  let routes = Object.entries(details.routes) as [Lane, TestRoute][];
  if (!sync) {
    const origin = readAddress(form, "origin");
    const destination = readAddress(form, "destination");
    const lane = laneFor(origin, destination);
    const route = { origin, destination };
    details.routes[lane] = route;
    routes = [[lane, route]];
  }
  const credentials = encrypt(details, storeId);
  const services = {
    ...(saved && row ? (row.services as Services) : emptyServices),
  };
  try {
    const signal = AbortSignal.timeout(8000);
    await Promise.all(
      routes.map(async ([lane, { origin, destination }]) => {
        const quotes = await quoteUps(
          details.auth,
          origin,
          destination,
          [{ grams: 1000, cm: [20, 15, 10] }],
          signal,
          routes.length > 1 ? row?.revision : undefined,
        );
        services[lane] = quotes.map(({ code, name }) => ({ code, name }));
      }),
    );
  } catch (error) {
    if (row && !connect && error instanceof CarrierFailure)
      await prisma.carrierConnection.updateMany({
        where: { ...where, revision: row.revision },
        data: { error: error.message },
      });
    throw error;
  }
  const data = {
    credentials,
    services,
    syncedAt: new Date(),
    error: null,
    revision: randomUUID(),
  };
  if (!row) {
    const created = await prisma.carrierConnection.createMany({
      data: { ...where, ...data },
      skipDuplicates: true,
    });
    if (!created.count)
      throw new CarrierFailure(
        "UPS was connected elsewhere. Refresh Settings.",
      );
  } else {
    const changed = await prisma.carrierConnection.updateMany({
      where: { ...where, revision: row.revision },
      data,
    });
    if (!changed.count)
      throw new CarrierFailure(
        "The carrier connection changed during the test. Refresh Settings.",
      );
  }
  return connect ? "UPS connected. Services synced." : "UPS services synced.";
}

// Bound request size and packing work within the checkout quote budget.
const parcelLimit = 50;

function parcelsFor(rate: LiveCarrierRate, cart: CarrierCart) {
  const parcels: Parcel[] = [];
  let omitted = 0;
  function add(parcel: Parcel, count = 1) {
    if (count + parcels.length > parcelLimit)
      throw new CarrierFailure(
        "ShipFlow can quote up to 50 UPS packages per shipment.",
      );
    for (let index = 0; index < count; index++) parcels.push({ ...parcel });
  }
  if (rate.packaging === "individual") {
    for (const line of cart.lines) {
      if (!lineVolume(line) || !line.grams) {
        omitted += line.quantity;
        continue;
      }
      add(
        {
          grams: line.grams,
          cm: dimensionAxes.map(
            (axis) => line.dimensions![axis]!,
          ) as Parcel["cm"],
        },
        line.quantity,
      );
    }
  } else {
    const packing = rate.packing!;
    const weight = weightGrams[packing.weightUnit ?? "kg"];
    const cm = (box: (typeof packing.packages)[number]) =>
      dimensionAxes.map((axis) =>
        dimensionInCm(Number(box[axis]), packing.dimensionUnit ?? "cm"),
      ) as Parcel["cm"];
    if (cart.lines.some((line) => !line.grams))
      throw new CarrierFailure(
        "Add the weight of every item for this packing method.",
      );
    if (rate.packaging === "dimensions") {
      const packed = packByDimensions(packing, cart.lines, true);
      if ("reason" in packed)
        throw new CarrierFailure(
          packed.reason === "missing-input"
            ? "An item is missing dimensions or weight."
            : "No package fits an item.",
        );
      for (const box of packed)
        add(
          {
            grams: box.contentGrams! + Number(box.package.emptyWeight) * weight,
            cm: cm(box.package),
          },
          box.count,
        );
    } else {
      const boxes = packing.packages
        .map((box) => ({
          limit:
            packing.split === "total"
              ? parseMoney(box.limit, cart.currency)
              : Number(box.limit),
          max: Number(box.maxWeight) * weight,
          empty: Number(box.emptyWeight) * weight,
          cm: cm(box),
        }))
        .sort((a, b) => b.limit - a.limit || b.max - a.max);
      const subtotal = cart.lines.reduce(
        (sum, line) => sum + line.price * line.quantity,
        0,
      );
      let open: { parcel: Parcel; remaining: number; max: number } | undefined;
      for (const line of cart.lines) {
        const grams = line.grams!;
        const volume = lineVolume(line);
        const units = {
          quantity: 1,
          total: subtotal ? line.price * (cart.subtotal / subtotal) : 0,
          weight: grams / weight,
          volume,
          volumetric:
            volume === undefined
              ? undefined
              : volume / dimensionalFactor(cart.volumetricDivisor),
        }[packing.split];
        if (units === undefined)
          throw new CarrierFailure(
            "An item is missing dimensions for cart-attribute packing.",
          );
        let remaining = line.quantity;
        while (remaining > 0) {
          if (
            !open ||
            open.remaining + 1e-8 < units ||
            open.parcel.grams + grams > open.max + 1e-8
          ) {
            const box = boxes.find(
              (box) =>
                box.limit + 1e-8 >= units &&
                box.max - box.empty + 1e-8 >= grams,
            );
            if (!box)
              throw new CarrierFailure(
                "No package meets the cart-attribute and weight limits.",
              );
            add({ grams: box.empty, cm: box.cm });
            open = {
              parcel: parcels.at(-1)!,
              remaining: box.limit,
              max: box.max,
            };
          }
          const count = Math.min(
            remaining,
            Math.floor((open.max - open.parcel.grams + 1e-8) / grams),
            units ? Math.floor((open.remaining + 1e-8) / units) : Infinity,
          );
          open.parcel.grams += count * grams;
          open.remaining -= count * units;
          remaining -= count;
        }
      }
    }
  }
  if (!parcels.length)
    throw new CarrierFailure(
      "No items have the weight and dimensions needed for a carrier quote.",
    );
  return { parcels, omitted };
}

export async function loadLiveQuotes(
  storeId: string,
  cart: CarrierCart,
  rates: FixedRate[],
  allowSandbox: boolean,
) {
  const results = new Map<string, CarrierQuoteResult>();
  if (!rates.length) return results;
  const row = rates.some((rate) => rate.liveCarrier?.carrier === "ups")
    ? await prisma.carrierConnection.findUnique({
        where: { storeId_carrier: { storeId, carrier: "ups" } },
      })
    : null;
  const signal = AbortSignal.timeout(1800);
  const requests = new Map<string, ReturnType<typeof quoteUps>>();
  await Promise.all(
    rates.map(async (rate) => {
      const live = rate.liveCarrier!;
      try {
        if (live.carrier !== "ups")
          throw new CarrierFailure(
            "This carrier does not have a quote adapter yet.",
          );
        if (!row) throw new CarrierFailure("UPS is disconnected.");
        const { auth } = decrypt(row.credentials, storeId);
        if (auth.environment === "sandbox" && !allowSandbox)
          throw new CarrierFailure(
            "A production UPS connection is required for live checkout.",
          );
        const origin =
          live.origin.type === "custom" ? live.origin : cart.origin;
        const destination = {
          ...cart.destination,
          postalCode: cart.postalCode ?? "",
          city: cart.city,
        };
        if (!origin?.postalCode || !destination.postalCode)
          throw new CarrierFailure(
            "Origin and destination postal codes are required.",
          );
        const { parcels, omitted } = parcelsFor(live, cart);
        const key = JSON.stringify([origin, destination, parcels]);
        let request = requests.get(key);
        if (!request) {
          if (requests.size >= 8)
            throw new CarrierFailure(
              "Too many distinct UPS shipments in this rate request.",
            );
          request = quoteUps(
            auth,
            { ...origin, postalCode: origin.postalCode },
            destination,
            parcels,
            signal,
            row.revision,
          );
          requests.set(key, request);
        }
        const received = await request;
        const lane =
          origin.country === destination.country ? "domestic" : "international";
        const currencyQuotes = received.filter(
          (quote) => quote.currency === cart.currency,
        );
        if (!currencyQuotes.length)
          throw new CarrierFailure(
            `UPS did not return a quote in ${cart.currency}.`,
          );
        const quotes = currencyQuotes.filter(
          ({ code }) => !live[lane].length || live[lane].includes(code),
        );
        const selection =
          lane === "international"
            ? (live.internationalSelection ?? live.selection)
            : live.selection;
        quotes.sort(
          (a, b) => a.amount - b.amount || a.code.localeCompare(b.code),
        );
        results.set(rate.id, {
          quotes:
            selection === "all"
              ? quotes
              : selection === "lowest"
                ? quotes.slice(0, 1)
                : quotes.slice(-1),
          detail: `${parcels.length} package(s)${omitted ? ` · ${omitted} unit(s) omitted for missing weight or dimensions` : ""}`,
        });
      } catch (error) {
        results.set(rate.id, {
          error:
            error instanceof CarrierFailure
              ? error.message
              : "The live carrier quote could not be calculated.",
        });
      }
    }),
  );
  return results;
}
