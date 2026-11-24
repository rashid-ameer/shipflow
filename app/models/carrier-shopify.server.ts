import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "@prisma/client";
import prisma from "../db.server";
import { resolveShopifyAppUrl } from "../app-url.server";
import type { AdminQuery } from "./delivery-customization-admin.server";

const STORE_CONTEXT = `#graphql
  query ShipFlowRatesContext {
    shop { currencyCode shopAddress { countryCodeV2 } }
  }`;
const CARRIER_LIST = `#graphql
  query ShipFlowCarrierServices($after: String) {
    carrierServices(first: 25, after: $after) {
      nodes { id active callbackUrl }
      pageInfo { endCursor hasNextPage }
    }
  }`;
const CREATE = `#graphql
  mutation ShipFlowCarrierCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService { id active callbackUrl }
      userErrors { code message }
    }
  }`;
const UPDATE = `#graphql
  mutation ShipFlowCarrierUpdate($input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(input: $input) {
      carrierService { id active callbackUrl }
      userErrors { code message }
    }
  }`;
const PROFILES = `#graphql
  query ShipFlowCarrierProfile {
    deliveryProfiles(first: 5) {
      nodes {
        profileLocationGroups {
          locationGroupZones(first: 5) {
            nodes {
              methodDefinitions(first: 8) {
                nodes {
                  active
                  rateProvider {
                    ... on DeliveryParticipant { carrierService { id active } }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

type CarrierService = {
  id: string;
  active: boolean;
  callbackUrl: string | null;
};
type UserError = { code?: string; message: string };
type CarrierMutation = {
  carrierService: CarrierService | null;
  userErrors: UserError[];
};
export class CarrierSetupError extends Error {
  constructor(
    message: string,
    readonly code?: "CCS_UNAVAILABLE",
  ) {
    super(message);
  }
}

export function signCarrierCallback(storeId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`shipflow-carrier-v1:${storeId}`)
    .digest("hex");
}

export function validCarrierCallback(
  storeId: string,
  token: string,
  secret?: string,
) {
  if (
    !secret ||
    !/^[a-z0-9-]{8,64}$/i.test(storeId) ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(signCarrierCallback(storeId, secret), "hex"),
  );
}

function carrierCallbackUrl(storeId: string) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret)
    throw new CarrierSetupError(
      "ShipFlow needs its app secret before connecting calculated shipping.",
    );
  try {
    const origin = new URL(resolveShopifyAppUrl(process.env));
    if (
      origin.protocol !== "https:" ||
      origin.hostname.endsWith(".trycloudflare.com")
    )
      throw new Error();
    return new URL(
      `/carrier-rates/${storeId}/${signCarrierCallback(storeId, secret)}`,
      origin,
    ).href;
  } catch {
    throw new CarrierSetupError(
      "Use ShipFlow’s stable public HTTPS address before connecting calculated shipping.",
    );
  }
}

async function gql<T>(
  graphql: AdminQuery,
  operation: string,
  variables?: Record<string, unknown>,
) {
  try {
    const response = await graphql(operation, { variables, tries: 1 });
    const result = (await response.json()) as {
      data?: T;
      errors?: UserError[];
    };
    if (!response.ok || !result.data || result.errors?.length)
      throw new Error(result.errors?.[0]?.message);
    return result.data;
  } catch (error) {
    if (
      error instanceof Error &&
      /scope|access denied|forbidden/i.test(error.message)
    ) {
      throw new CarrierSetupError(
        "Approve ShipFlow’s shipping access in Shopify, then try again.",
      );
    }
    throw new CarrierSetupError(
      "Shopify could not confirm calculated shipping setup. Try again.",
    );
  }
}

export async function getStorePricingContext(graphql: AdminQuery) {
  const { shop } = await gql<{
    shop: {
      currencyCode: string;
      shopAddress: { countryCodeV2: string | null };
    };
  }>(graphql, STORE_CONTEXT);
  return {
    currency: shop.currencyCode,
    country: shop.shopAddress.countryCodeV2,
  };
}

async function findCarrier(
  graphql: AdminQuery,
  store: Store,
  expectedUrl: string,
) {
  let after: string | null = null;
  type Page = {
    carrierServices: {
      nodes: CarrierService[];
      pageInfo: { hasNextPage: boolean; endCursor: string };
    };
  };
  do {
    const result: Page = await gql<Page>(graphql, CARRIER_LIST, { after });
    const record = result.carrierServices.nodes.find(
      (row) =>
        row.id === store.carrierServiceId || row.callbackUrl === expectedUrl,
    );
    if (record) return record;
    after = result.carrierServices.pageInfo.hasNextPage
      ? result.carrierServices.pageInfo.endCursor
      : null;
  } while (after);
  return null;
}

export async function connectCarrierService(graphql: AdminQuery, shop: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1::int FROM pg_advisory_xact_lock(hashtext(${shop}))`;
      const store = await tx.store.findUniqueOrThrow({
        where: { shopDomain: shop },
      });
      if (store.mode !== "CCS_RATES" || store.onboardingStep !== "COMPLETE") {
        throw new CarrierSetupError(
          "Select CCS Rates before connecting calculated shipping.",
        );
      }
      const callbackUrl = carrierCallbackUrl(store.id);
      const service = await findCarrier(graphql, store, callbackUrl);
      let carrier = service;
      if (!carrier?.active || carrier.callbackUrl !== callbackUrl) {
        const input = {
          name: "ShipFlow",
          callbackUrl,
          active: true,
          supportsServiceDiscovery: false,
        };
        const result = service
          ? (
              await gql<{ carrierServiceUpdate: CarrierMutation }>(
                graphql,
                UPDATE,
                { input: { ...input, id: service.id } },
              )
            ).carrierServiceUpdate
          : (
              await gql<{ carrierServiceCreate: CarrierMutation }>(
                graphql,
                CREATE,
                { input },
              )
            ).carrierServiceCreate;
        if (result.userErrors.length) {
          const { code, message } = result.userErrors[0];
          const eligibility =
            /plan|eligib|not enabled|must be enabled|not supported/i.test(
              `${code ?? ""} ${message}`,
            );
          if (eligibility)
            throw new CarrierSetupError(
              "Carrier Calculated Shipping is unavailable on this store. Enable it in Shopify or connect ShipFlow on a store with calculated shipping enabled.",
              "CCS_UNAVAILABLE",
            );
          throw new CarrierSetupError(
            "Shopify did not connect the Carrier Service. Check Shipping and delivery settings, then try again.",
          );
        }
        carrier = result.carrierService;
      }
      if (!carrier?.active || carrier.callbackUrl !== callbackUrl) {
        throw new CarrierSetupError(
          "Shopify did not confirm an active ShipFlow callback.",
        );
      }
      await tx.store.update({
        where: { id: store.id },
        data: { carrierServiceId: carrier.id, ccsStatus: "ENABLED" },
      });
    },
    { timeout: 20_000 },
  );
}

export async function getCarrierSetup(graphql: AdminQuery, store: Store) {
  if (!store.carrierServiceId)
    return { connected: false, profileAttached: false, issue: null };
  try {
    const expected = carrierCallbackUrl(store.id);
    const carrier = await findCarrier(graphql, store, expected);
    const connected =
      carrier?.active === true && carrier.callbackUrl === expected;
    if (!connected)
      return {
        connected: false,
        profileAttached: false,
        issue: "Reconnect ShipFlow to refresh its callback.",
      };
    type Definition = {
      active: boolean;
      rateProvider?: { carrierService?: { id: string; active: boolean } };
    };
    type Profiles = {
      deliveryProfiles: {
        nodes: {
          profileLocationGroups: {
            locationGroupZones: {
              nodes: { methodDefinitions: { nodes: Definition[] } }[];
            };
          }[];
        }[];
      };
    };
    try {
      const { deliveryProfiles } = await gql<Profiles>(graphql, PROFILES);
      const profileAttached = deliveryProfiles.nodes.some((profile) =>
        profile.profileLocationGroups.some((group) =>
          group.locationGroupZones.nodes.some((zone) =>
            zone.methodDefinitions.nodes.some(
              (method) =>
                method.active &&
                method.rateProvider?.carrierService?.active &&
                method.rateProvider.carrierService.id === carrier.id,
            ),
          ),
        ),
      );
      return { connected: true, profileAttached, issue: null };
    } catch {
      return {
        connected: true,
        profileAttached: false,
        issue:
          "Shopify did not confirm shipping profile setup. Check it in Shopify.",
      };
    }
  } catch (error) {
    return {
      connected: false,
      profileAttached: false,
      issue: carrierErrorDetails(error).error,
    };
  }
}

export function carrierErrorDetails(error: unknown) {
  if (error instanceof CarrierSetupError) {
    return {
      error: error.message,
      ccsUnavailable: error.code === "CCS_UNAVAILABLE",
    };
  }
  return {
    error: "Calculated shipping setup could not be saved. Try again.",
    ccsUnavailable: false,
  };
}
