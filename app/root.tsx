import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

/**
 * Document shell. Polaris web components load via AppProvider
 * (`https://cdn.shopify.com/shopifycloud/polaris.js`) in app routes —
 * no duplicate script tag needed here.
 */
export const meta = () => [{ title: "ShipFlow" }];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
