import { BorderedCard } from "../components/bordered-card";
import {
  IndexTableFilterChips,
  IndexTableFilters,
  IndexTableRowActions,
  IndexTableSection,
} from "../components/index-table";
import { useEffect, useRef, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop-settings.server";
import {
  requestCatalogSync,
  setCatalogAutoSync,
} from "../models/catalog.server";
import {
  asDimensionUnit,
  catalogLimit,
  dimensionAxes,
  productsPath,
  readDimensionMapping,
} from "../models/product-dimensions";
import {
  csvLimit,
  dimensionEmailReady,
  exportDimensionsCsv,
  importDimensionsCsv,
  readDimensionRecipient,
  sendDimensionEmail,
} from "../models/dimensions-csv.server";
import {
  clampIndexPage,
  INDEX_PAGE_SIZE,
  indexPageCount,
} from "../pagination";
const axes = { length: "Length", width: "Width", height: "Height" };

async function productContext(request: Request) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  return { store, unit: asDimensionUnit(store.settings.dimensionUnit) };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { store } = await productContext(request);
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 120);
  const search = query.length >= 3 ? query : "";
  const where: Prisma.CatalogProductWhereInput = {
    storeId: store.id,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { searchTags: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [sync, count] = await Promise.all([
    prisma.catalogSync.findUnique({ where: { storeId: store.id } }),
    prisma.catalogProduct.count({ where }),
  ]);
  const requested = Number(params.get("page"));
  const totalPages = indexPageCount(count);
  const page = clampIndexPage(requested, count);
  const products = await prisma.catalogProduct.findMany({
    where,
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: INDEX_PAGE_SIZE,
    skip: (page - 1) * INDEX_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      tags: true,
      _count: { select: { variants: true } },
    },
  });
  return {
    query,
    page,
    totalPages,
    count,
    emailReady: dimensionEmailReady(),
    products: products.map(({ id, ...product }) => ({
      id: id.toString(),
      ...product,
    })),
    sync: {
      job: sync?.job,
      auto: sync?.autoSync ?? true,
      lastSyncAt: sync?.lastSyncAt?.toISOString(),
      lastMetafieldSyncAt: sync?.lastMetafieldSyncAt?.toISOString(),
      error: sync?.error,
      limit: sync?.limitReached,
      processed: sync?.processed,
      rejected: sync?.rejected,
      mapping: readDimensionMapping(sync?.mapping),
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { store, unit } = await productContext(request);
  try {
    const form = await request.formData();
    const intent = form.get("intent");
    if (intent === "sync" || intent === "metafields") {
      const raw = form.get("mapping");
      if (
        intent === "metafields" &&
        (typeof raw !== "string" || raw.length > 3000)
      )
        throw new Error("Enter the metafield mapping.");
      await requestCatalogSync(
        store.id,
        unit,
        typeof raw === "string"
          ? readDimensionMapping(JSON.parse(raw))
          : undefined,
      );
      return {
        ok: true as const,
        message:
          intent === "sync" ? "Product sync queued" : "Metafield sync queued",
      };
    }
    if (intent === "automatic") {
      await setCatalogAutoSync(store.id, form.get("enabled") === "true");
      return { ok: true as const, message: "Auto-sync preference saved" };
    }
    if (intent !== "email" && intent !== "import")
      throw new Error("Choose a supported action.");
    const recipient =
      intent === "email" || dimensionEmailReady()
        ? readDimensionRecipient(form.get("email"))
        : undefined;
    if (intent === "email") {
      let part = 0;
      for await (const csv of exportDimensionsCsv(store.id, unit)) {
        part++;
        await sendDimensionEmail(
          recipient!,
          `ShipFlow product dimensions (part ${part})`,
          "Enter the dimensions you want to update, then upload this CSV in ShipFlow. Blank cells leave saved dimensions unchanged.",
          { filename: `shipflow-dimensions-${part}.csv`, csv },
        );
      }
      return {
        ok: true as const,
        message: `Sent ${part} CSV ${part === 1 ? "email" : "emails"}.`,
      };
    }
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      !/\.csv$/i.test(file.name) ||
      !file.size ||
      file.size > csvLimit
    )
      throw new Error("Upload a CSV file up to 25 MB.");
    const report = await importDimensionsCsv(store.id, await file.text(), unit);
    const message = `Updated ${report.updated} ${report.updated === 1 ? "variant" : "variants"}. ${report.invalid} ${report.invalid === 1 ? "row" : "rows"} could not be imported.`;
    let emailError: string | undefined;
    try {
      if (recipient)
        await sendDimensionEmail(
          recipient,
          "ShipFlow dimension import results",
          [message, ...report.problems].join("\n"),
        );
    } catch {
      emailError =
        "The results email could not be sent. The import results are shown below.";
    }
    return { ok: true as const, message, report, emailError };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "ShipFlow could not complete this action. Try again.",
    };
  }
}

export default function Products() {
  const { sync, products, query, count, page, totalPages, emailReady } =
    useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [, setSearch] = useSearchParams();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const [search, setQuery] = useState(query);
  const [mapping, setMapping] = useState(sync.mapping);
  const [recipient, setRecipient] = useState("");
  const [file, setFile] = useState<File>();
  const [uploadVersion, setUploadVersion] = useState(0);
  const [dialog, setDialog] = useState<"mapping" | "csv">();
  const csvModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const mappingModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const previous = useRef<typeof fetcher.data>(undefined);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => setQuery(query), [query]);
  useEffect(() => {
    if (
      search.trim() === query ||
      (search.trim().length && search.trim().length < 3)
    )
      return;
    const timer = window.setTimeout(
      () =>
        setSearch(search.trim() ? { q: search.trim() } : {}, { replace: true }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search, query, setSearch]);
  useEffect(() => {
    if (!sync.job) return;
    const timer = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [sync.job, revalidator]);
  useEffect(() => {
    if (busy || !result || previous.current === result) return;
    previous.current = result;
    if (!result.ok) return;
    shopify.toast.show(result.message);
    if (result.report) {
      setFile(undefined);
      setUploadVersion((version) => version + 1);
      csvModal.current?.hideOverlay();
    }
    if (result.message === "Metafield sync queued") {
      mappingModal.current?.hideOverlay();
    }
  }, [busy, result, shopify]);
  function submit(intent: string, values: Record<string, string> = {}) {
    fetcher.submit({ intent, ...values }, { method: "post" });
  }
  function upload() {
    if (!file) return;
    const form = new FormData();
    form.set("intent", "import");
    form.set("file", file);
    form.set("email", recipient);
    fetcher.submit(form, { method: "post", encType: "multipart/form-data" });
  }
  function navigate(next: number) {
    setSearch({
      ...(query ? { q: query } : {}),
      ...(next > 1 ? { page: String(next) } : {}),
    });
  }
  const date = (iso: string) => new Date(iso).toLocaleString();

  return (
    <s-page heading="Products">
      <s-button
        slot="secondary-actions"
        commandFor="dimensions-csv"
        command="--show"
        onClick={() => setDialog("csv")}
      >
        Import product dimensions
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={busy || Boolean(sync.job)}
        commandFor="dimension-mapping"
        command="--show"
        onClick={() => {
          setMapping(sync.mapping);
          setDialog("mapping");
        }}
      >
        Sync metafields
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={busy || Boolean(sync.job)}
        onClick={() => submit("sync")}
      >
        Sync products
      </s-button>
      <s-stack gap="base">
        {result && !result.ok && !dialog ? (
          <s-banner tone="critical" heading="Action could not be completed">
            {result.error}
          </s-banner>
        ) : null}
        {sync.error ? (
          <s-banner tone="warning" heading="Catalog sync needs attention">
            {sync.error}
          </s-banner>
        ) : null}
        {sync.limit ? (
          <s-banner tone="info" heading="Catalog limit reached">
            ShipFlow syncs up to {catalogLimit.toLocaleString()} products.
          </s-banner>
        ) : null}
        {result?.ok && result.report ? (
          <s-banner
            tone={
              result.report.invalid || result.emailError ? "warning" : "success"
            }
            heading="Dimension import finished"
          >
            <s-stack gap="small">
              <s-paragraph>{result.message}</s-paragraph>
              {result.emailError ? (
                <s-paragraph>{result.emailError}</s-paragraph>
              ) : null}
              {result.report.problems.map((problem) => (
                <s-paragraph key={problem}>{problem}</s-paragraph>
              ))}
            </s-stack>
          </s-banner>
        ) : null}
        <BorderedCard heading="Catalog sync">
          <s-stack gap="small">
            {sync.job ? (
              <s-badge tone="info">
                {sync.job === "catalog"
                  ? "Syncing products"
                  : "Syncing metafields"}{" "}
                · {sync.processed ?? 0} processed
              </s-badge>
            ) : null}
            <s-paragraph>
              {sync.lastSyncAt
                ? `Last product sync ${date(sync.lastSyncAt)}`
                : "Products have not been synced yet."}
            </s-paragraph>
            {sync.lastMetafieldSyncAt ? (
              <s-paragraph>
                Last metafield sync {date(sync.lastMetafieldSyncAt)}
                {!sync.job && sync.rejected
                  ? ` · ${sync.rejected} variants skipped`
                  : ""}
              </s-paragraph>
            ) : null}
            <s-switch
              label="Sync products daily"
              checked={sync.auto}
              disabled={busy}
              onChange={(event) =>
                submit("automatic", {
                  enabled: String(event.currentTarget.checked),
                })
              }
            />
          </s-stack>
        </BorderedCard>
        <IndexTableSection
          label="Synced products"
          paginate={totalPages > 1}
          hasPreviousPage={page > 1}
          hasNextPage={page < totalPages}
          onPreviousPage={() => navigate(page - 1)}
          onNextPage={() => navigate(page + 1)}
          filters={
            <>
              <IndexTableFilters columns="minmax(0, 1fr)">
                <s-search-field
                  label="Search by product name or tag"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search by product name or tag"
                  value={search}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </IndexTableFilters>
              <IndexTableFilterChips
                filters={
                  query
                    ? [
                        {
                          label: `Search: ${query}`,
                          onRemove: () => {
                            setQuery("");
                            setSearch({});
                          },
                        },
                      ]
                    : []
                }
                onClearAll={() => {
                  setQuery("");
                  setSearch({});
                }}
              />
            </>
          }
        >
          <s-table-header-row>
            <s-table-header listSlot="primary">Name</s-table-header>
            <s-table-header>Variants</s-table-header>
            <s-table-header>Tags</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.map((product) => (
              <s-table-row
                key={product.id}
                clickDelegate={`product-${product.id}`}
              >
                <s-table-cell>
                  <s-button
                    id={`product-${product.id}`}
                    variant="tertiary"
                    href={`${productsPath}/${product.id}`}
                  >
                    {product.title}
                  </s-button>
                </s-table-cell>
                <s-table-cell>
                  {product._count.variants > 1 ? product._count.variants : ""}
                </s-table-cell>
                <s-table-cell>{product.tags.join(", ")}</s-table-cell>
                <s-table-cell>
                  <IndexTableRowActions id={product.id} label={product.title}>
                    <s-button
                      icon="edit"
                      href={`${productsPath}/${product.id}`}
                    >
                      Edit dimensions
                    </s-button>
                    <s-button
                      icon="clipboard"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(product.id);
                          shopify.toast.show("Product ID copied");
                        } catch {
                          shopify.toast.show(
                            "Copy the product ID from the product details.",
                            { isError: true },
                          );
                        }
                      }}
                    >
                      Copy product ID
                    </s-button>
                  </IndexTableRowActions>
                </s-table-cell>
              </s-table-row>
            ))}
            {query ? (
              <s-empty-state heading="No products match this search">
                <s-icon slot="graphic" type="search" />
                <s-text slot="subheading">
                  Try a different product name or tag.
                </s-text>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => {
                    setQuery("");
                    setSearch({});
                  }}
                >
                  Clear filters
                </s-button>
              </s-empty-state>
            ) : (
              <s-empty-state
                heading={sync.job ? "Products are syncing" : "Sync products"}
              >
                <s-text slot="subheading">
                  {sync.job
                    ? "Synced products will appear here."
                    : "Sync products to edit their dimensions."}
                </s-text>
              </s-empty-state>
            )}
          </s-table-body>
        </IndexTableSection>
      </s-stack>
      <s-modal
        id="dimension-mapping"
        ref={mappingModal}
        heading="Sync product dimensions from metafields"
        onHide={() =>
          setDialog((current) => (current === "mapping" ? undefined : current))
        }
      >
        <s-stack gap="base">
          <s-paragraph>
            Map existing Shopify metafields to one or more dimensions. Numeric
            metafields use your shop’s dimension unit.
          </s-paragraph>
          {result && !result.ok && dialog === "mapping" ? (
            <s-banner tone="critical">{result.error}</s-banner>
          ) : null}
          {dimensionAxes.map((axis) => (
            <s-stack key={axis} gap="small">
              <s-heading>{axes[axis]}</s-heading>
              <s-select
                label={`${axes[axis]} metafield owner`}
                value={mapping[axis].owner}
                onChange={(event) => {
                  const owner =
                    event.currentTarget.value === "product"
                      ? "product"
                      : "variant";
                  setMapping({
                    ...mapping,
                    [axis]: { ...mapping[axis], owner },
                  });
                }}
              >
                <s-option value="variant">Variant</s-option>
                <s-option value="product">Product</s-option>
              </s-select>
              <s-text-field
                label={`${axes[axis]} namespace`}
                value={mapping[axis].namespace}
                onInput={(event) =>
                  setMapping({
                    ...mapping,
                    [axis]: {
                      ...mapping[axis],
                      namespace: event.currentTarget.value,
                    },
                  })
                }
              />
              <s-text-field
                label={`${axes[axis]} key`}
                value={mapping[axis].key}
                onInput={(event) =>
                  setMapping({
                    ...mapping,
                    [axis]: {
                      ...mapping[axis],
                      key: event.currentTarget.value,
                    },
                  })
                }
              />
            </s-stack>
          ))}
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="dimension-mapping"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={busy}
          onClick={() =>
            submit("metafields", { mapping: JSON.stringify(mapping) })
          }
        >
          Sync metafields
        </s-button>
      </s-modal>
      <s-modal
        id="dimensions-csv"
        ref={csvModal}
        heading="Import product dimensions"
        onHide={() =>
          setDialog((current) => (current === "csv" ? undefined : current))
        }
      >
        <s-stack gap="base">
          <s-paragraph>
            Email a CSV of your synced variants, fill in the dimensions, then
            upload it here. Blank cells keep their saved values.
          </s-paragraph>
          {!emailReady ? (
            <s-banner tone="warning">
              Email delivery is unavailable. You can still upload a CSV and view
              the results here.
            </s-banner>
          ) : null}
          {result && !result.ok && dialog === "csv" ? (
            <s-banner tone="critical">{result.error}</s-banner>
          ) : null}
          {emailReady ? (
            <>
              <s-email-field
                label="Email address"
                required
                value={recipient}
                disabled={busy}
                onInput={(event) => setRecipient(event.currentTarget.value)}
              />
              <s-button
                disabled={!recipient || busy}
                onClick={() => submit("email", { email: recipient })}
              >
                Send CSV
              </s-button>
            </>
          ) : null}
          <s-drop-zone
            key={uploadVersion}
            label="Add a CSV file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => setFile(event.currentTarget.files?.[0])}
          />
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="dimensions-csv"
          command="--hide"
        >
          Close
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={!file || (emailReady && !recipient) || busy}
          onClick={upload}
        >
          Upload CSV
        </s-button>
      </s-modal>
    </s-page>
  );
}
