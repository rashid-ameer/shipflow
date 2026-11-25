import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  type CarrierCart,
  type PricingResult,
  testIdentity,
} from "./calculated-rates";
import {
  cartSnapshot,
  historyCutoff,
  type historyFilters,
} from "./checkout-history";

export async function recordCarrierRequest(
  storeId: string,
  cart: CarrierCart | null,
  result: PricingResult,
  statusCode: number,
) {
  const entry = {
    country: cart?.destination.country ?? "",
    province: cart?.destination.province,
    currency: cart?.currency ?? "",
    customerId: cart?.customerId,
    testIdentity: cart ? testIdentity(cart) : "missing",
    reason: result.reason,
    rateCount: result.rates.length,
    statusCode,
    snapshot: cart ? (cartSnapshot(cart) as Prisma.InputJsonObject) : undefined,
    trace: (result.trace as Prisma.InputJsonObject | null) ?? undefined,
  };
  try {
    await prisma.carrierRequest.create({ data: { storeId, ...entry } });
  } catch {
    console.warn("ShipFlow could not save carrier request diagnostics.");
  }
}

export async function listCarrierRequests(
  storeId: string,
  filters: ReturnType<typeof historyFilters>,
  matchingCustomers: string[],
) {
  const recent = { storeId, receivedAt: { gte: historyCutoff() } };
  const where: Prisma.CarrierRequestWhereInput = {
    storeId,
    receivedAt: { gte: filters.start, lt: filters.end },
    ...(filters.search
      ? {
          OR: [
            { id: { contains: filters.search, mode: "insensitive" } },
            { customerId: { in: matchingCustomers } },
            ...(filters.search.toLowerCase() === "shipflow"
              ? [{ testIdentity: "test" }]
              : []),
          ],
        }
      : {}),
  };
  const [count, anyRequests] = await Promise.all([
    prisma.carrierRequest.count({ where }),
    prisma.carrierRequest.findFirst({ where: recent, select: { id: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(count / 25));
  const page = Math.min(filters.page, pageCount);
  const rows = await prisma.carrierRequest.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 25,
    skip: (page - 1) * 25,
    select: {
      id: true,
      receivedAt: true,
      country: true,
      province: true,
      customerId: true,
      testIdentity: true,
      reason: true,
      rateCount: true,
      statusCode: true,
    },
  });
  return { rows, page, pageCount, hasRequests: Boolean(anyRequests) };
}

export function getCarrierRequest(storeId: string, id: string) {
  return prisma.carrierRequest.findFirst({
    where: { storeId, id, receivedAt: { gte: historyCutoff() } },
  });
}

export async function recordHistoryDataRequest(
  shopDomain: string,
  requestId: string,
  customerId: string,
) {
  const shop = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      carrierRequests: { where: { customerId }, select: { id: true }, take: 1 },
    },
  });
  if (shop?.carrierRequests.length)
    await prisma.historyDataRequest.upsert({
      where: { storeId_requestId: { storeId: shop.id, requestId } },
      create: { storeId: shop.id, customerId, requestId },
      update: {},
    });
}

export function listHistoryDataRequests(storeId: string) {
  return prisma.historyDataRequest.findMany({
    where: { storeId },
    select: { requestId: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 25,
  });
}

export async function historyCustomerExport(
  shopDomain: string,
  requestId: string,
) {
  const request = await prisma.historyDataRequest.findFirst({
    where: { requestId, store: { shopDomain } },
  });
  if (!request) return null;
  const history = await prisma.carrierRequest.findMany({
    where: {
      storeId: request.storeId,
      customerId: request.customerId,
      receivedAt: { lte: request.receivedAt },
    },
    select: {
      id: true,
      receivedAt: true,
      country: true,
      province: true,
      snapshot: true,
      trace: true,
      statusCode: true,
      reason: true,
      rateCount: true,
      testIdentity: true,
    },
    orderBy: { receivedAt: "desc" },
  });
  return { requestId, customerId: request.customerId, history };
}
