import { useState } from "react";
import { useFetcher } from "react-router";
import type { CarrierService } from "../models/live-carrier";

export type UpsConnection = {
  services: { domestic: CarrierService[]; international: CarrierService[] };
  syncedAt: string | null;
  error: string | null;
  revision: string;
} | null;

export function UpsConnectionPanel({
  connection,
}: {
  connection: UpsConnection;
}) {
  const fetcher = useFetcher<{
    ok: boolean;
    error?: string;
    message?: string;
  }>();
  const [editing, setEditing] = useState<"connect" | "test" | "disconnect">();
  const busy = fetcher.state !== "idle";
  const isTest = editing === "test";
  const action = "/app/settings?tab=carriers";
  const submit = (intent: string) =>
    fetcher.submit(
      { intent, revision: connection?.revision ?? "" },
      { action, method: "post" },
    );
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small">
        <s-badge
          tone={
            connection?.error ? "critical" : connection ? "success" : "neutral"
          }
        >
          {connection?.error
            ? "Error"
            : connection
              ? "Connected"
              : "Not connected"}
        </s-badge>
        {connection?.syncedAt ? (
          <s-text>
            Last sync {connection.syncedAt.slice(0, 16).replace("T", " ")} UTC
          </s-text>
        ) : null}
      </s-stack>
      {fetcher.data?.error || connection?.error ? (
        <s-banner tone="critical">
          {fetcher.data?.error ?? connection?.error}
        </s-banner>
      ) : null}
      {fetcher.data?.message ? (
        <s-banner tone="success">{fetcher.data.message}</s-banner>
      ) : null}
      <s-stack direction="inline" gap="small">
        <s-button disabled={busy} onClick={() => setEditing("connect")}>
          {connection ? "Replace credentials" : "Connect UPS"}
        </s-button>
        {connection ? (
          <>
            <s-button
              disabled={busy}
              loading={
                busy && fetcher.formData?.get("intent") === "carrier-sync"
              }
              onClick={() => submit("carrier-sync")}
            >
              Sync services
            </s-button>
            <s-button disabled={busy} onClick={() => setEditing("test")}>
              Test another route
            </s-button>
            <s-button
              disabled={busy}
              tone="critical"
              onClick={() => setEditing("disconnect")}
            >
              Disconnect
            </s-button>
          </>
        ) : null}
      </s-stack>
      {editing === "disconnect" && connection ? (
        <s-banner tone="warning">
          UPS rates will use their configured fallback while disconnected.
          <s-stack direction="inline" gap="small">
            <s-button
              disabled={busy}
              tone="critical"
              onClick={() => {
                submit("carrier-disconnect");
                setEditing(undefined);
              }}
            >
              Disconnect UPS
            </s-button>
            <s-button disabled={busy} onClick={() => setEditing(undefined)}>
              Cancel
            </s-button>
          </s-stack>
        </s-banner>
      ) : editing && editing !== "disconnect" ? (
        <fetcher.Form
          key={editing}
          method="post"
          action={action}
          onSubmit={() => setEditing(undefined)}
        >
          <input
            type="hidden"
            name="intent"
            value={isTest ? "carrier-test" : "carrier-connect"}
          />
          <input
            type="hidden"
            name="revision"
            value={connection?.revision ?? ""}
          />
          <s-stack gap="base">
            {!isTest ? (
              <>
                <s-select
                  name="environment"
                  label="UPS environment"
                  value="production"
                >
                  <s-option value="production">Production</s-option>
                  <s-option value="sandbox">Sandbox</s-option>
                </s-select>
                <s-text-field
                  name="account"
                  label="UPS account number"
                  required
                  maxLength={6}
                />
                <s-text-field
                  name="clientId"
                  label="UPS client ID"
                  required
                  maxLength={512}
                />
                <s-password-field
                  name="clientSecret"
                  label="UPS client secret"
                  required
                />
              </>
            ) : null}
            <s-paragraph>
              Enter a route UPS can quote. A test shipment is 1 kg and 20 × 15 ×
              10 cm. Use a domestic and an international route to discover each
              service list.
            </s-paragraph>
            {(["origin", "destination"] as const).map((side) => (
              <s-grid
                key={side}
                gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 135px), 1fr))"
                gap="small"
              >
                <s-text-field
                  name={`${side}Country`}
                  label={`${side === "origin" ? "Origin" : "Destination"} country code`}
                  maxLength={2}
                  required
                />
                <s-text-field
                  name={`${side}Postal`}
                  label="Postal code"
                  maxLength={16}
                  required
                />
                <s-text-field
                  name={`${side}Province`}
                  label="State or province code"
                  maxLength={8}
                />
              </s-grid>
            ))}
            <s-stack direction="inline" gap="small">
              <s-button type="submit" variant="primary" disabled={busy}>
                {isTest ? "Test and sync" : "Test and connect"}
              </s-button>
              <s-button disabled={busy} onClick={() => setEditing(undefined)}>
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      ) : null}
    </s-stack>
  );
}
