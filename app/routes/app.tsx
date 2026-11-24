import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Outlet,
  redirect,
  useLoaderData,
  useRouteError,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";

import {
  getOrCreateShop,
  nextOnboardingPath,
  OnboardingStep,
  OperatingMode,
} from "../models/shop-settings.server";
import { POLARIS_URL } from "../polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  const isOnboardingRoute = url.pathname.startsWith("/app/onboarding");

  if (
    store.onboardingStep !== OnboardingStep.COMPLETE &&
    !isOnboardingRoute
  ) {
    throw redirect(nextOnboardingPath(store.onboardingStep) + url.search);
  }
  if (
    store.onboardingStep === OnboardingStep.COMPLETE &&
    isOnboardingRoute
  ) {
    throw redirect("/app" + url.search);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY!,
    onboarded: store.onboardingStep === OnboardingStep.COMPLETE,
    mode:
      store.mode === OperatingMode.CCS_RATES
        ? ("ccs-rates" as const)
        : ("delivery-customization" as const),
  };
}

export default function AppLayout() {
  const { apiKey, onboarded, mode } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey} polarisUrl={POLARIS_URL}>
      {onboarded ? (
        <s-app-nav>
          {/* App Nav supports rel=home although the generic s-link type omits it. */}
          {/* @ts-expect-error App Nav-specific link attribute. */}
          <s-link href="/app" rel="home">
            Home
          </s-link>
          <s-link href="/app">Home</s-link>
          {mode === "ccs-rates" ? (
            <s-link href="/app#setup-checklist">Rates</s-link>
          ) : (
            <s-link href="/app#setup-checklist">Delivery customizations</s-link>
          )}
          <s-link href="/app/settings">Settings</s-link>
        </s-app-nav>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
