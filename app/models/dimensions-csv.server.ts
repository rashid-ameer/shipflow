import prisma from "../db.server";
import { catalogId } from "./catalog-shopify.server";
import { updateCatalogDimensions } from "./catalog.server";
import {
  dimensionAxes,
  formatDimension,
  readDimensions,
  type Dimensions,
  type DimensionValues,
} from "./product-dimensions";
import { DIMENSION_UNITS, type DimensionUnit } from "./shipping-settings";

export const csvLimit = 25_000_000;
const columns = ["product_id", "variant_id", ...dimensionAxes, "unit"];

function* csvRows(text: string): Generator<string[]> {
  const input = text.replace(/^\uFEFF/, "");
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') value += char;
      else if (input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === '"') {
      if (value || closed)
        throw new Error("The CSV contains an invalid quoted value.");
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(value);
      value = "";
      closed = false;
      if (char !== ",") {
        if (char === "\r" && input[i + 1] === "\n") i++;
        yield row;
        row = [];
      }
    } else {
      if (closed)
        throw new Error("The CSV contains characters after a quoted value.");
      value += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  if (row.length || value || closed) yield [...row, value];
}

export function parseDimensionsCsv(
  content: string,
  defaultUnit: DimensionUnit,
) {
  const rows = csvRows(content);
  const header = rows.next().value as string[] | undefined;
  const keys = header?.map((item) => item.trim().toLowerCase()) ?? [];
  if (
    columns.slice(0, -1).some((column) => !keys.includes(column)) ||
    new Set(keys).size !== keys.length
  )
    throw new Error(
      "The CSV must have product_id, variant_id, length, width, and height columns.",
    );
  const entries = new Map<
    bigint,
    {
      id: bigint;
      productId: bigint;
      dimensions: Partial<Dimensions>;
      row: number;
    }
  >();
  const seen = new Set<bigint>();
  const problems: string[] = [];
  let invalid = 0;
  let rowNumber = 1;
  function reject(row: number, reason: string) {
    invalid++;
    if (problems.length < 20) problems.push(`Row ${row}: ${reason}`);
  }
  for (const row of rows) {
    rowNumber++;
    if (row.every((cell) => !cell.trim())) continue;
    const cell = (key: string) => row[keys.indexOf(key)]?.trim() ?? "";
    const id = catalogId(cell("variant_id"));
    const productId = catalogId(cell("product_id"));
    if (!id || !productId || row.length !== keys.length) {
      reject(
        rowNumber,
        "Enter whole-number product and variant IDs and a value for every column.",
      );
      continue;
    }
    if (seen.has(id)) {
      const previous = entries.get(id);
      if (previous) {
        reject(previous.row, "The variant ID appears more than once.");
        entries.delete(id);
      }
      reject(rowNumber, "The variant ID appears more than once.");
      continue;
    }
    seen.add(id);
    try {
      const unit = cell("unit").toLowerCase() || defaultUnit;
      if (!DIMENSION_UNITS.includes(unit as DimensionUnit))
        throw new Error("Use mm, cm, m, in, or ft for the dimension unit.");
      const values = Object.fromEntries(
        dimensionAxes.map((axis) => [axis, cell(axis)]),
      ) as DimensionValues;
      const dimensions = Object.fromEntries(
        Object.entries(readDimensions(values, unit as DimensionUnit)).filter(
          ([, size]) => size !== null,
        ),
      );
      if (Object.keys(dimensions).length)
        entries.set(id, { id, productId, dimensions, row: rowNumber });
    } catch (error) {
      reject(
        rowNumber,
        error instanceof Error ? error.message : "Enter valid dimensions.",
      );
    }
  }
  return {
    entries: [...entries.values()],
    problems,
    invalid,
    reject,
    invalidCount: () => invalid,
  };
}

export async function importDimensionsCsv(
  storeId: string,
  csv: string,
  unit: DimensionUnit,
) {
  const parsed = parseDimensionsCsv(csv, unit);
  const updated = await prisma.$transaction(
    async (tx) => {
      let saved = 0;
      for (let offset = 0; offset < parsed.entries.length; offset += 500) {
        const batch = parsed.entries.slice(offset, offset + 500);
        const matches = await tx.catalogVariant.findMany({
          where: { storeId, id: { in: batch.map(({ id }) => id) } },
          select: { id: true, productId: true, revision: true },
        });
        const variants = new Map(
          matches.map((variant) => [variant.id, variant]),
        );
        const entries = batch.flatMap((entry) => {
          const variant = variants.get(entry.id);
          if (variant?.productId === entry.productId)
            return [{ ...entry, revision: variant.revision }];
          parsed.reject(
            entry.row,
            "The variant does not belong to this product in your synced catalog.",
          );
          return [];
        });
        const count = await updateCatalogDimensions(tx, storeId, entries);
        if (count !== entries.length)
          throw new Error(
            "Some dimensions changed during import. Upload the file again.",
          );
        saved += count;
      }
      return saved;
    },
    { timeout: 120_000 },
  );
  return { updated, invalid: parsed.invalidCount(), problems: parsed.problems };
}

export async function* exportDimensionsCsv(
  storeId: string,
  unit: DimensionUnit,
) {
  const header = columns.join(",");
  let lines = [header];
  let cursor = 0n;
  while (true) {
    const batch = await prisma.catalogVariant.findMany({
      where: { storeId, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: 1_000,
    });
    for (const row of batch) {
      lines.push(
        [
          row.productId,
          row.id,
          ...dimensionAxes.map((axis) =>
            row[axis] === null ? "" : formatDimension(row[axis], unit),
          ),
          unit,
        ].join(","),
      );
      if (lines.length === 25_001) {
        yield lines.join("\r\n");
        lines = [header];
      }
    }
    if (batch.length < 1_000) break;
    cursor = batch.at(-1)!.id;
  }
  if (lines.length > 1 || !cursor) yield lines.join("\r\n");
}

export function dimensionEmailReady() {
  return Boolean(process.env.RESEND_API_KEY && process.env.SHIPFLOW_EMAIL_FROM);
}

export function readDimensionRecipient(value: unknown) {
  const email = typeof value === "string" ? value.trim() : "";
  if (
    email.length > 254 ||
    !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)
  )
    throw new Error("Enter a valid email address.");
  return email;
}

export async function sendDimensionEmail(
  recipient: string,
  subject: string,
  message: string,
  attachment?: { filename: string; csv: string },
) {
  if (!dimensionEmailReady())
    throw new Error("Email delivery is unavailable. Contact ShipFlow support.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: process.env.SHIPFLOW_EMAIL_FROM,
      to: [recipient],
      subject,
      text: message,
      ...(attachment
        ? {
            attachments: [
              {
                filename: attachment.filename,
                content: Buffer.from(attachment.csv).toString("base64"),
              },
            ],
          }
        : {}),
    }),
  }).catch(() => undefined);
  if (!response?.ok) throw new Error("The email could not be sent. Try again.");
}
