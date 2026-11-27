/// <reference types="vite/client" />
/// <reference types="@react-router/node" />
/// <reference types="@shopify/app-bridge-types" />

import type { ReactNode } from "react";

type EmptyStateProps = {
  heading?: string;
  children?: ReactNode;
  id?: string;
  slot?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-empty-state": EmptyStateProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-empty-state": EmptyStateProps;
    }
  }
}
