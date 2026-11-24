# ShipFlow project guidance

ShipFlow is a Shopify embedded app using React Router 7 framework mode, React 18, TypeScript, Polaris web components, Prisma, and PostgreSQL. `app/routes.ts` defines routes explicitly. Keep Shopify authentication, App Bridge, and webhook handling compatible with the installed Shopify packages.

## Project skills

Use the skills in `.agents/skills/` when their task applies:

- `react-router-framework-mode`: routes, loaders, actions, pending UI, and streaming.
- `feature-sliced-design`: decide where page, feature, and shared code belongs. Apply incrementally to this existing `app/` layout; do not create empty layers or move working routes just to match a diagram.
- `vercel-composition-patterns`: component hierarchy and reusable React interfaces. Skip its React 19 rules while the app uses React 18.
- `vercel-react-best-practices`: investigate rendering, bundle size, data loading, and interaction performance. Apply React advice only when it fits React Router; skip Next.js-only APIs and React 19-only APIs.
- `codebase-design`: shape shipping-rule domain logic behind small, testable interfaces.
- `domain-modeling`: keep shipping-rule terms and important decisions consistent as the product grows.
- `diagnosing-bugs`: reproduce and measure failures or performance regressions before changing code.

## Placement and performance

- Keep route modules in `app/routes/`; they own route-level authentication, loaders, actions, error handling, and page composition.
- Keep UI and state used by one page near that page. Extract shared UI or domain logic only when reuse or an independent responsibility is real.
- Keep server-only Shopify API, database, and secret-handling code in server modules. Do not import them into browser components.
- Treat shipping-rule evaluation as domain logic, separate from display components. Keep its inputs and outputs explicit so it can be tested without rendering a page.
- For slow pages, measure the bottleneck first. Load independent server data concurrently; stream noncritical data behind a `Suspense` boundary when React Router supports it in the installed version. Use lazy imports for genuinely heavy, optional UI.
- Use Polaris web components for embedded admin UI. The current choice cards are UI choices, not billing plans; do not introduce Lite/Pro billing flows unless requested.
