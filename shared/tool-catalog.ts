/**
 * Tool-catalog wire format for `GET /api/tools`.
 *
 * Shared by the Express route that serves the catalog and the frontend
 * Zustand store that consumes it, so the shape changes in one place.
 *
 * Fields are deliberately a subset of the server-side `ToolModule` —
 * only the pieces the UI needs to render the Tools-node picker. The
 * `ToolClassification` union is duplicated here rather than imported
 * from the server, per the project convention that `shared/` must not
 * depend on `server/`.
 */

export type ToolClassification = 'read-only' | 'state-mutating' | 'destructive';

export interface ToolCatalogEntry {
  /** Canonical name, e.g. `calculator`. Aliases are not listed. */
  name: string;
  /** Human-readable label for the picker. */
  label: string;
  /** Short description — used as a tooltip in the picker. */
  description: string;
  /**
   * Group key, matching `TOOL_GROUPS` in `shared/resolve-tool-names.ts`.
   * Absent for tools that don't belong to a preset group — typically
   * user-installed tools.
   */
  group?: string;
  /** Safety classification; absent means "state-mutating" by default. */
  classification?: ToolClassification;
}

export type ToolCatalogResponse = ToolCatalogEntry[];
