import { IndexTableSection } from "../components/index-table";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useBlocker,
  useFetcher,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop-settings.server";
import { catalogId } from "../models/catalog-shopify.server";
import { updateCatalogDimensions } from "../models/catalog.server";
import {
  asDimensionUnit,
  dimensionAxes,
  formatDimension,
  productsPath,
  readDimensions,
  type DimensionValues,
} from "../models/product-dimensions";

const saveBar = "product-dimensions-save-bar";
const pageSize = 30;
const labels = { length: "Length", width: "Width", height: "Height" };

async function productContext({
  request,
  params,
}: LoaderFunctionArgs | ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  const productId = catalogId(params.id);
  const product =
    productId &&
    (await prisma.catalogProduct.findUnique({
      where: { storeId_id: { storeId: store.id, id: productId } },
      select: { title: true, _count: { select: { variants: true } } },
    }));
  if (!productId || !product)
    throw new Response("Product not found.", { status: 404 });
  return {
    storeId: store.id,
    productId,
    product,
    unit: asDimensionUnit(store.settings.dimensionUnit),
  };
}

export async function loader(args: LoaderFunctionArgs) {
  const { storeId, productId, product, unit } = await productContext(args);
  const requested = Number(new URL(args.request.url).searchParams.get("page"));
  const pages = Math.max(1, Math.ceil(product._count.variants / pageSize));
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(pages, requested)
      : 1;
  const variants = await prisma.catalogVariant.findMany({
    where: { storeId, productId },
    orderBy: { id: "asc" },
    take: pageSize,
    skip: (page - 1) * pageSize,
  });
  return {
    id: String(productId),
    title: product.title,
    unit,
    page,
    pages,
    rows: variants.map((row) => ({
      id: String(row.id),
      title: row.title,
      sku: row.sku,
      revision: row.revision,
      values: Object.fromEntries(
        dimensionAxes.map((axis) => [
          axis,
          row[axis] === null ? "" : formatDimension(row[axis], unit),
        ]),
      ) as DimensionValues,
    })),
  };
}

export async function action(args: ActionFunctionArgs) {
  const { storeId, productId, unit } = await productContext(args);
  const form = await args.request.formData();
  const raw = form.get("dimensions");
  try {
    if (form.get("unit") !== unit)
      throw new Error(
        "The dimension unit changed. Reopen the product and try again.",
      );
    if (typeof raw !== "string" || raw.length > 30_000)
      throw new Error("Enter valid variant dimensions.");
    const draft = JSON.parse(raw) as {
      id: string;
      revision: number;
      values: DimensionValues;
    }[];
    if (!Array.isArray(draft) || !draft.length || draft.length > pageSize)
      throw new Error("Choose the variants to update.");
    const entries = draft.map(({ id, revision, values }) => {
      const variantId = catalogId(id);
      if (
        !variantId ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        !values ||
        dimensionAxes.some((axis) => typeof values[axis] !== "string")
      )
        throw new Error("Enter valid variant dimensions.");
      return {
        id: variantId,
        revision,
        dimensions: readDimensions(values, unit),
      };
    });
    if (new Set(entries.map(({ id }) => id)).size !== entries.length)
      throw new Error("A variant appears more than once.");
    await prisma.$transaction(async (tx) => {
      const count = await tx.catalogVariant.count({
        where: {
          storeId,
          productId,
          id: { in: entries.map(({ id }) => id) },
        },
      });
      if (count !== entries.length)
        throw new Error(
          "The product variants changed. Reopen the product and try again.",
        );
      if (
        (await updateCatalogDimensions(tx, storeId, entries)) !== entries.length
      )
        throw new Error(
          "Some dimensions changed elsewhere. Reopen the product and try again.",
        );
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Check the dimensions and try again.",
    };
  }
}

export default function ProductDimensions() {
  const data = useLoaderData<typeof loader>();
  return <DimensionsEditor key={`${data.id}:${data.page}`} initial={data} />;
}

function DimensionsEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof loader>>;
}) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [, setParams] = useSearchParams();
  const [draft, setDraft] = useState<
    Record<string, { values: DimensionValues; revision: number }>
  >({});
  const [draftUnit, setDraftUnit] = useState(initial.unit);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const handled = useRef<typeof fetcher.data>(undefined);
  const dirty = Object.keys(draft).length > 0;
  const busy = fetcher.state !== "idle";
  const unitChanged = dirty && draftUnit !== initial.unit;
  const blocker = useBlocker(dirty);
  useEffect(() => {
    void customElements
      .whenDefined("s-number-field")
      .then(() => setReady(true));
  }, []);
  useEffect(() => {
    if (dirty) void shopify.saveBar.show(saveBar);
    else void shopify.saveBar.hide(saveBar);
  }, [dirty, shopify]);
  useEffect(
    () => () => {
      void shopify.saveBar.hide(saveBar);
    },
    [shopify],
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      blocker.reset();
      void shopify.saveBar.leaveConfirmation();
    }
  }, [blocker, shopify]);
  useEffect(() => {
    if (busy || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (!fetcher.data.ok) return;
    setDraft({});
    setVersion((value) => value + 1);
    shopify.toast.show("Dimensions saved");
  }, [busy, fetcher.data, shopify]);
  function patch(
    row: (typeof initial.rows)[number],
    field: keyof DimensionValues,
    value: string,
  ) {
    if (!dirty) setDraftUnit(initial.unit);
    setDraft((current) => {
      const next = {
        ...row.values,
        ...current[row.id]?.values,
        [field]: value,
      };
      const entries = { ...current };
      if (dimensionAxes.every((axis) => next[axis] === row.values[axis]))
        delete entries[row.id];
      else
        entries[row.id] = {
          values: next,
          revision: current[row.id]?.revision ?? row.revision,
        };
      return entries;
    });
  }
  function save() {
    if (!dirty || busy || unitChanged) return;
    const dimensions = Object.entries(draft).map(([id, fields]) => ({
      id,
      ...fields,
    }));
    fetcher.submit(
      { unit: draftUnit, dimensions: JSON.stringify(dimensions) },
      { method: "post" },
    );
  }
  function back(event: { preventDefault: () => void }) {
    if (!dirty) return;
    event.preventDefault();
    void shopify.saveBar.leaveConfirmation();
  }
  function navigate(page: number) {
    if (dirty) {
      void shopify.saveBar.leaveConfirmation();
      return;
    }
    setParams(page > 1 ? { page: String(page) } : {});
  }

  return (
    <s-page heading={initial.title}>
      <s-link href={productsPath} slot="breadcrumb-actions" onClick={back}>
        Products
      </s-link>
      <ui-save-bar id={saveBar}>
        <button
          type="button"
          variant="primary"
          disabled={!dirty || busy || unitChanged}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft({});
            setVersion((value) => value + 1);
          }}
        >
          Discard
        </button>
      </ui-save-bar>
      <s-stack gap="base">
        {fetcher.data && !fetcher.data.ok && dirty ? (
          <s-banner tone="critical" heading="Dimensions could not be saved">
            {fetcher.data.error}
          </s-banner>
        ) : null}
        {unitChanged ? (
          <s-banner tone="warning">
            The shop’s dimension unit changed. Discard your edits before
            continuing in the new unit.
          </s-banner>
        ) : null}
        <s-paragraph>
          Enter measurements in {initial.unit}. Leave an unknown dimension
          blank.
        </s-paragraph>
        <IndexTableSection
          key={version}
          label="Variant dimensions"
          paginate={initial.pages > 1}
          hasPreviousPage={initial.page > 1}
          hasNextPage={initial.page < initial.pages}
          onPreviousPage={() => navigate(initial.page - 1)}
          onNextPage={() => navigate(initial.page + 1)}
        >
          <s-table-header-row>
            <s-table-header listSlot="primary">Variant</s-table-header>
            {dimensionAxes.map((axis) => (
              <s-table-header key={axis}>
                {labels[axis]} ({initial.unit})
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {initial.rows.map((row) => (
              <s-table-row key={row.id}>
                <s-table-cell>
                  <s-stack gap="small">
                    {row.title}
                    {row.sku ? (
                      <s-text color="subdued">{row.sku}</s-text>
                    ) : null}
                  </s-stack>
                </s-table-cell>
                {dimensionAxes.map((axis) => (
                  <s-table-cell key={axis}>
                    <s-number-field
                      label={`${row.title} ${labels[axis]} (${initial.unit})`}
                      labelAccessibilityVisibility="exclusive"
                      min={0}
                      inputMode="decimal"
                      value={draft[row.id]?.values[axis] ?? row.values[axis]}
                      disabled={busy || !ready || unitChanged}
                      onInput={(event) =>
                        patch(row, axis, event.currentTarget.value)
                      }
                    />
                  </s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </IndexTableSection>
        <s-stack direction="inline" gap="small" justifyContent="end">
          <s-button href={productsPath} onClick={back}>
            Back
          </s-button>
          <s-button
            variant="primary"
            disabled={!dirty || busy || unitChanged}
            loading={busy}
            onClick={save}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
    </s-page>
  );
}
