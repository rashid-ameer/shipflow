import type { ReactNode } from "react";

export function BorderedCard({
  heading,
  children,
  id,
}: {
  heading: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <s-box
      id={id}
      accessibilityRole="section"
      accessibilityLabel={heading}
      background="base"
      border="base base solid"
      borderRadius="base"
      padding="base"
    >
      <s-stack gap="base">
        <s-heading>{heading}</s-heading>
        {children}
      </s-stack>
    </s-box>
  );
}
