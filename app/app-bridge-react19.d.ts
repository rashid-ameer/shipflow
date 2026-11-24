import type {
  SAppNavAttributes,
  UISaveBarAttributes,
} from "@shopify/app-bridge-types";

// App Bridge currently publishes these elements in the legacy global JSX
// namespace. React 19 reads custom elements from React.JSX instead.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavAttributes;
      "ui-save-bar": UISaveBarAttributes;
    }
  }
}

