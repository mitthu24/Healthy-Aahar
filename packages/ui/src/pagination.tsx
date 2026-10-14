import { Button } from './button.js';

export type PaginationMeta = { limit: number; next_cursor: string | null; has_more: boolean };

/**
 * Cursor pagination only — this codebase never offers offset pagination
 * (skips/repeats rows on a list that's actively being written). "Previous"
 * is therefore intentionally not offered; the caller keeps a stack of prior
 * cursors if back-navigation is needed.
 */
export function Pagination({
  pagination,
  onLoadMore,
  isLoading,
}: {
  pagination: PaginationMeta | null;
  onLoadMore: () => void;
  isLoading?: boolean;
}) {
  if (!pagination?.has_more) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="secondary" onClick={onLoadMore} isLoading={isLoading}>
        Load more
      </Button>
    </div>
  );
}
