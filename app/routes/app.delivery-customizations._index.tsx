import {
  redirect,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import {
  deliveryCheckoutStatus,
  deliveryPaths,
  DELIVERY_LIMIT,
} from "../models/delivery-customization";
import {
  getDeliveryRules,
  getDeliveryStatus,
} from "../models/delivery-customization.server";
import { getOrCreateShop } from "../models/shop-settings.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (
    store.onboardingStep !== "COMPLETE" ||
    store.mode !== "DELIVERY_CUSTOMIZATION"
  ) {
    throw redirect("/app");
  }
  const rows = await getDeliveryRules(store.id);
  const { states, used, issue } = await getDeliveryStatus(
    admin.graphql,
    rows,
    store,
  );
  return {
    rows: rows.map(({ id, name, active }) => ({
      id,
      name,
      active,
      status: states[id],
    })),
    used,
    issue,
    appEnabled: store.appEnabled,
  };
}

export default function DeliveryCustomizations() {
  const { rows, used, issue, appEnabled } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  return (
    <s-page heading="Delivery customizations">
      <s-link slot="breadcrumb-actions" href="/app">
        Home
      </s-link>
      <s-stack gap="base">
        {issue ? (
          <s-banner tone="warning" heading="Could not check checkout status">
            <s-paragraph>{issue}</s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              loading={revalidator.state !== "idle"}
              onClick={() => revalidator.revalidate()}
            >
              Refresh
            </s-button>
          </s-banner>
        ) : !appEnabled ? (
          <s-banner tone="info" heading="Delivery customizations are paused">
            <s-paragraph>
              Enable ShipFlow in Settings to resume your active customizations.
            </s-paragraph>
            <s-button
              slot="secondary-actions"
              variant="secondary"
              href="/app/settings"
            >
              Open Settings
            </s-button>
          </s-banner>
        ) : null}
        <s-section
          heading={
            rows.length === 0
              ? "Create your first customization"
              : "Customizations"
          }
        >
          <s-stack gap="base">
            {rows.length === 0 ? (
              <s-paragraph>
                Hide, rename, or reorder the delivery options Shopify already
                offers at checkout.
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">
                    Customization
                  </s-table-header>
                  <s-table-header listSlot="inline">
                    Saved status
                  </s-table-header>
                  <s-table-header listSlot="labeled">
                    At checkout
                  </s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((row) => {
                    const status = deliveryCheckoutStatus[row.status];
                    return (
                      <s-table-row key={row.id}>
                        <s-table-cell>
                          <s-link href={deliveryPaths.edit(row.id)}>
                            {row.name}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>
                          {row.active ? "Active" : "Inactive"}
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={status.tone}>{status.label}</s-badge>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            )}
            {used !== null ? (
              <s-paragraph>
                {used} of {DELIVERY_LIMIT} active customization slots used
                across all apps.
              </s-paragraph>
            ) : null}
            <s-stack direction="inline" justifyContent="end">
              <s-button variant="primary" href={deliveryPaths.create}>
                Create customization
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
