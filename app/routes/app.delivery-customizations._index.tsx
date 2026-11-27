import {
  IndexTableRowActions,
  IndexTableSection,
} from "../components/index-table";
import { useAppBridge } from "@shopify/app-bridge-react";
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
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  return (
    <s-page heading="Delivery customizations">
      <s-link slot="breadcrumb-actions" href="/app">
        Home
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        href={deliveryPaths.create}
      >
        Create customization
      </s-button>
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
        <IndexTableSection label="Delivery customizations">
          <s-table-header-row>
            <s-table-header listSlot="primary">Customization</s-table-header>
            <s-table-header listSlot="inline">Saved status</s-table-header>
            <s-table-header listSlot="labeled">At checkout</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((row) => {
              const status = deliveryCheckoutStatus[row.status];
              return (
                <s-table-row key={row.id} clickDelegate={`customization-${row.id}`}>
                  <s-table-cell>
                    <s-link
                      id={`customization-${row.id}`}
                      href={deliveryPaths.edit(row.id)}
                    >
                      {row.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.active ? "Active" : "Inactive"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={status.tone}>{status.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <IndexTableRowActions id={row.id} label={row.name}>
                      <s-button
                        icon="edit"
                        href={deliveryPaths.edit(row.id)}
                      >
                        Edit customization
                      </s-button>
                      <s-button
                        icon="clipboard"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(row.id);
                            shopify.toast.show("Customization ID copied");
                          } catch {
                            shopify.toast.show(
                              "Copy the customization ID from the editor.",
                              { isError: true },
                            );
                          }
                        }}
                      >
                        Copy customization ID
                      </s-button>
                    </IndexTableRowActions>
                  </s-table-cell>
                </s-table-row>
              );
            })}
            {rows.length === 0 ? (
              <s-empty-state heading="Create your first customization">
                <s-text slot="subheading">
                  Hide, rename, or reorder the delivery options Shopify already
                  offers at checkout.
                </s-text>
              </s-empty-state>
            ) : null}
          </s-table-body>
        </IndexTableSection>
        {used !== null ? (
          <s-paragraph>
            {used} of {DELIVERY_LIMIT} active customization slots used across all
            apps.
          </s-paragraph>
        ) : null}
      </s-stack>
    </s-page>
  );
}
