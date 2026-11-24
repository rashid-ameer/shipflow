import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("app", "routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("onboarding", "routes/app.onboarding._index.tsx"),
    route("onboarding/units", "routes/app.onboarding.units.tsx"),
    route("onboarding/mode", "routes/app.onboarding.mode.tsx"),
    route("settings", "routes/app.settings.tsx"),
  ]),
  route("auth/login", "routes/auth.login/route.tsx"),
  route("auth/*", "routes/auth.$.tsx"),
  route("health", "routes/health.ts"),
  route("webhooks/app/uninstalled", "routes/webhooks.app.uninstalled.tsx"),
  route("webhooks/app/scopes_update", "routes/webhooks.app.scopes_update.tsx"),
  route("webhooks/privacy", "routes/webhooks.privacy.tsx"),
] satisfies RouteConfig;
