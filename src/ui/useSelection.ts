import { useState } from "react";

/**
 * Bulk-selection state for Multi-Move.
 *
 * A selection is always scoped to exactly one bucket — the top level, or one
 * specific folder — because every bulk action ("move these 5 into X") only makes
 * sense within one. Passing the scope in and comparing it during render means
 * navigating elsewhere clears the selection without an effect and without a
 * stale frame showing the previous scope's checkmarks.
 */
export interface Selection {
  count: number;
  has(bundleId: string): boolean;
  toggle(bundleId: string): void;
  selectAll(bundleIds: string[]): void;
  clear(): void;
  /** The selected ids, in the order given by `all`. */
  ordered(all: { bundleId: string }[]): string[];
}

const EMPTY: ReadonlySet<string> = new Set();

export function useSelection(scopeKey: string): Selection {
  const [state, setState] = useState<{ scopeKey: string; ids: ReadonlySet<string> }>({
    scopeKey,
    ids: EMPTY,
  });

  const ids = state.scopeKey === scopeKey ? state.ids : EMPTY;

  return {
    count: ids.size,
    has: (bundleId) => ids.has(bundleId),
    toggle: (bundleId) =>
      setState((prev) => {
        const next = new Set(prev.scopeKey === scopeKey ? prev.ids : EMPTY);
        if (next.has(bundleId)) next.delete(bundleId);
        else next.add(bundleId);
        return { scopeKey, ids: next };
      }),
    selectAll: (bundleIds) => setState({ scopeKey, ids: new Set(bundleIds) }),
    clear: () => setState({ scopeKey, ids: EMPTY }),
    ordered: (all) => all.map((a) => a.bundleId).filter((id) => ids.has(id)),
  };
}
