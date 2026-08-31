'use client';
import { useEffect, useRef } from 'react';
import { users as usersApi, type UserPreferences } from './api';
import { useAuth } from './auth';

/**
 * "The table looks how I left it."
 *
 * One implicit view per table per user — no naming, no switcher, no explicit
 * save. Whatever the operator last had on screen is what they get back after
 * logging out and in again, on whatever machine.
 *
 * It rides in `user.preferences`, the same JSON column the cleaner's pool
 * filter already uses, so there is no new table and no new endpoint: the
 * self-service PATCH /users/me/preferences takes the whole blob.
 *
 * Named, switchable, shareable views are a different feature with a different
 * shape (a real table, tenant scoping, sharing rules). This is deliberately
 * not the first half of that.
 */

export type SortDir = 'asc' | 'desc';

export interface SavedTableView {
  /** Column keys the operator hid. */
  hidden?: string[];
  /** Per-column value filters. Sets do not survive JSON, so: arrays. */
  filters?: Record<string, string[]>;
  sort?: { key: string; dir: SortDir } | null;
  frozenCols?: number;
  frozenRows?: number;
  tint?: boolean;
}

/** How long the table must sit still before the view is written back. */
const SAVE_DEBOUNCE_MS = 700;

function viewsFor(prefs: UserPreferences | undefined, scope: string): Record<string, SavedTableView> {
  const all = (prefs?.tableViews ?? {}) as Record<string, Record<string, SavedTableView>>;
  return all[scope] ?? {};
}

function fingerprint(scope: string, key: string, view: SavedTableView | null): string {
  return view ? `${scope}:${key}:${JSON.stringify(view)}` : `${scope}:${key}:`;
}

/**
 * The view this user last left on `key`, or null if they have never touched it.
 *
 * Null means "apply the table's own defaults" and is not the same as an empty
 * view — an operator who deliberately unhid every column must get that back,
 * not the default hidden set.
 */
export function readSavedView(
  prefs: UserPreferences | undefined,
  scope: string,
  key: string,
): SavedTableView | null {
  if (!key) return null;
  const view = viewsFor(prefs, scope)[key];
  return view && typeof view === 'object' ? view : null;
}

/** Sets in, arrays out — the shape that survives the round trip. */
export function toSavedView(view: {
  hidden: Set<string>;
  filters: Record<string, Set<string>>;
  sort: { key: string; dir: SortDir } | null;
  frozenCols: number;
  frozenRows: number;
  tint: boolean;
}): SavedTableView {
  const filters: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(view.filters)) {
    // Array.from, not spread: this tsconfig targets below ES2015 and
    // spreading a Set needs downlevelIteration.
    if (set.size > 0) filters[k] = Array.from(set);
  }
  return {
    hidden: Array.from(view.hidden),
    filters,
    sort: view.sort,
    frozenCols: view.frozenCols,
    frozenRows: view.frozenRows,
    tint: view.tint,
  };
}

/** Arrays back to Sets, with every field optional so an old blob still loads. */
export function fromSavedView(view: SavedTableView) {
  const filters: Record<string, Set<string>> = {};
  for (const [k, values] of Object.entries(view.filters ?? {})) {
    if (Array.isArray(values) && values.length) filters[k] = new Set(values);
  }
  return {
    hidden: new Set(view.hidden ?? []),
    filters,
    sort: view.sort ?? null,
    frozenCols: typeof view.frozenCols === 'number' ? view.frozenCols : null,
    frozenRows: typeof view.frozenRows === 'number' ? view.frozenRows : null,
    tint: typeof view.tint === 'boolean' ? view.tint : null,
  };
}

/**
 * Write `view` back to the server whenever it settles.
 *
 * `enabled` is the important argument. A table restores its saved view *after*
 * it has painted the defaults, so for a beat the state on screen is not the
 * operator's view — saving during that beat would overwrite what we are in the
 * middle of restoring. Callers pass false until the restore has landed.
 *
 * Failures are swallowed. A view that did not save is a small annoyance next
 * time; an error banner over a working table is a bigger one now.
 */
export function useSaveTableView(
  scope: string,
  key: string,
  view: SavedTableView | null,
  enabled: boolean,
) {
  // What we last wrote, so an idle table with a re-rendering parent does not
  // PATCH on every render.
  const lastWritten = useRef<string>('');

  // Restoring a view re-runs this effect with the just-restored value. Seeding
  // the ref on the first enabled pass for a given table makes that a no-op
  // instead of a round trip that saves back what we just read.
  const seeded = useRef<string>('');

  useEffect(() => {
    if (!enabled || !key || !view) return;

    const serialised = JSON.stringify(view);

    if (seeded.current !== `${scope}:${key}`) {
      seeded.current = `${scope}:${key}`;
      lastWritten.current = serialised;
      return;
    }
    if (lastWritten.current === serialised) return;

    const timer = setTimeout(async () => {
      // Read the store at write time, not at render time: another screen may
      // have changed preferences since this effect was scheduled, and the
      // whole blob goes up on every PATCH.
      const { user, token, setAuth } = useAuth.getState();
      if (!user || !token) return;

      const prefs = user.preferences ?? {};
      const allViews = (prefs.tableViews ?? {}) as Record<string, Record<string, SavedTableView>>;
      const next: UserPreferences = {
        ...prefs,
        tableViews: {
          ...allViews,
          [scope]: { ...(allViews[scope] ?? {}), [key]: view },
        },
      };

      lastWritten.current = serialised;
      try {
        const updated = await usersApi.updateMyPreferences(next);
        // Keep the store in step so a reload inside this session restores the
        // view without waiting for /auth/me.
        const current = useAuth.getState().user;
        if (current) setAuth(token, { ...current, preferences: updated.preferences });
      } catch {
        // Let the next change try again.
        lastWritten.current = '';
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `fingerprint` collapses scope/key/value into one dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint(scope, key, view), enabled]);
}
