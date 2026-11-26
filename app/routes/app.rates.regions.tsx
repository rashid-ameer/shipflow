import {
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { rateIdPattern, ratesPaths } from "../models/calculated-rates";
import {
  deleteRegion,
  listRegions,
  loadRatesContext,
  rateFormFailure,
  RateFormError,
  saveRegion,
} from "../models/calculated-rates.server";
import { requireRatesStore } from "../models/rates-access.server";
import { RegionsManager } from "../components/regions-manager";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, store } = await requireRatesStore(request);
  await loadRatesContext(admin.graphql, store);
  return { regions: await listRegions(store.id) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { store } = await requireRatesStore(request, true);
  const form = await request.formData();
  try {
    const intent = form.get("intent");
    const id = form.get("id");
    if (
      intent === "delete" &&
      typeof id === "string" &&
      rateIdPattern.test(id)
    ) {
      const count = Number(form.get("expectedCount"));
      if (!Number.isSafeInteger(count) || count < 0)
        throw new RateFormError("Refresh the region before deleting it.");
      await deleteRegion(store.shopDomain, id, count);
    } else if (
      intent === "save" &&
      (id === "" || (typeof id === "string" && rateIdPattern.test(id)))
    ) {
      const json = form.get("coverage");
      if (typeof json !== "string" || json.length > 30_000)
        throw new RateFormError("Check the countries and provinces.");
      await saveRegion(
        store.shopDomain,
        id || null,
        form.get("name"),
        JSON.parse(json),
      );
    } else {
      throw new RateFormError("Choose a valid region action.");
    }
    return { ok: true as const, intent };
  } catch (error) {
    return rateFormFailure(error);
  }
}

export default function RegionsPage() {
  const { regions } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Shipping regions">
      <s-link slot="breadcrumb-actions" href={ratesPaths.hub}>
        Rates
      </s-link>
      <RegionsManager regions={regions} />
    </s-page>
  );
}
