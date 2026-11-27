import type { ReactNode } from "react";

export function IndexTableSection({
  label,
  loading = false,
  paginate = false,
  hasPreviousPage = false,
  hasNextPage = false,
  onPreviousPage,
  onNextPage,
  children,
}: {
  label: string;
  loading?: boolean;
  paginate?: boolean;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
  children: ReactNode;
}) {
  return (
    <s-section padding="none" accessibilityLabel={label}>
      <s-table
        loading={loading}
        paginate={paginate}
        hasPreviousPage={hasPreviousPage}
        hasNextPage={hasNextPage}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
      >
        {children}
      </s-table>
    </s-section>
  );
}

export function IndexTableFilters({
  columns = "minmax(0, 1fr) auto",
  children,
}: {
  columns?: string;
  children: ReactNode;
}) {
  return (
    <s-grid
      slot="filters"
      gap="small-200"
      gridTemplateColumns={columns}
    >
      {children}
    </s-grid>
  );
}

export function IndexTableFilterChips({
  filters,
  onClearAll,
}: {
  filters: { label: string; onRemove: () => void }[];
  onClearAll: () => void;
}) {
  if (!filters.length) return null;
  return (
    <s-stack
      slot="filters"
      direction="inline"
      gap="small-200"
      alignItems="center"
    >
      {filters.map((filter) => (
        <s-clickable-chip
          key={filter.label}
          removable
          accessibilityLabel={`Remove ${filter.label} filter`}
          onRemove={filter.onRemove}
        >
          {filter.label}
        </s-clickable-chip>
      ))}
      <s-button variant="tertiary" onClick={onClearAll}>
        Clear all
      </s-button>
    </s-stack>
  );
}

export function IndexTableBulkActions({
  count,
  total,
  children,
}: {
  count: number;
  total: number;
  children: ReactNode;
}) {
  return (
    <s-box slot="filters" padding="small" background="strong">
      <s-stack
        direction="inline"
        gap="small"
        alignItems="center"
        justifyContent="space-between"
      >
        <s-text type="strong">
          {count} of {total} selected
        </s-text>
        <s-stack direction="inline" gap="small">
          {children}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
