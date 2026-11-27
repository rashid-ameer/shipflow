export const INDEX_PAGE_SIZE = 10;

export function indexPageCount(total: number) {
  return Math.max(1, Math.ceil(total / INDEX_PAGE_SIZE));
}

export function clampIndexPage(requested: number, total: number) {
  const pages = indexPageCount(total);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, pages)
    : 1;
}
