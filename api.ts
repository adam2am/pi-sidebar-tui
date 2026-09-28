/**
 * Panel Protocol v1 — the entire public contract for the sidebar panel registry.
 *
 * External extensions register a panel descriptor over the shared pi event bus
 * (see CH below). Nothing in this file imports pi; it is a standalone type +
 * validation module so consumers (and tests) can depend on it in isolation.
 */

/** Version of the panel protocol. Bumped on any breaking contract change. */
export const PANEL_PROTOCOL = 1 as const;

/** Event-bus channels of the panel protocol. */
export const CH = {
  register: "pi-sidebar-tui/register/v1",
  unregister: "pi-sidebar-tui/unregister/v1",
  invalidate: "pi-sidebar-tui/invalidate/v1",
  ready: "pi-sidebar-tui/ready/v1",
} as const;

/** Default `order` for a panel that does not declare one. Builtins use 10–40. */
export const DEFAULT_PANEL_ORDER = 100;

/** Lowest accepted `order` value. */
export const MIN_PANEL_ORDER = 0;

/** Lowest accepted `maxLines` value. */
export const MIN_PANEL_MAX_LINES = 1;

/** Per-render context handed to `PanelDescriptor.render`. */
export interface PanelRenderCtx {
  /** Registry frame counter; advances on every `tick()`. */
  readonly frame: number;
}

/** A panel contributed by an extension (or a builtin). */
export interface PanelDescriptor {
  /** Reverse-DNS unique id, e.g. "agents-todo.todos". */
  readonly id: string;
  /** Header / debug label. */
  readonly title: string;
  /** Lower renders earlier. Defaults to {@link DEFAULT_PANEL_ORDER}. */
  readonly order?: number;
  /** Sidebar-owned animation cadence in ms; ticks only while visible. */
  readonly tickMs?: number;
  /** Hard line cap enforced by the sidebar. */
  readonly maxLines?: number;
  /** Id of a builtin this panel supersedes; the superseded panel hides. */
  readonly replaces?: string;
  /** Synchronous, fast, must never throw. Returning `[]` hides the panel. */
  render(ctx: PanelRenderCtx, width: number): string[];
}

/** Where a registered panel came from. */
export type PanelSource = "builtin" | "external";

/** Per-panel user configuration overlay (from the settings file). */
export interface PanelUserOverride {
  readonly enabled?: boolean;
  readonly order?: number;
  readonly maxLines?: number;
}

/** Immutable snapshot of a registered panel, for the debug listing. */
export interface PanelEntry {
  readonly id: string;
  readonly title: string;
  /** Effective order after applying the user override. */
  readonly order: number;
  readonly tickMs?: number;
  /** False when user-disabled, breaker-tripped, or superseded by `replaces`. */
  readonly enabled: boolean;
  readonly source: PanelSource;
  readonly lastError: string | null;
  readonly failCount: number;
}

/** Result of `registry.register`. Invalid input never throws — it is rejected. */
export type RegisterOutcome =
  | { readonly ok: true; readonly warning?: string }
  | { readonly ok: false; readonly reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate an arbitrary value as a {@link PanelDescriptor}.
 * Returns `null` when valid, otherwise a human-readable rejection reason.
 */
export function validatePanelDescriptor(d: unknown): string | null {
  if (!isPlainObject(d)) return "descriptor must be an object";

  const id = d["id"];
  if (typeof id !== "string" || id.length === 0) {
    return "id must be a non-empty string";
  }

  const title = d["title"];
  if (typeof title !== "string" || title.length === 0) {
    return "title must be a non-empty string";
  }

  if (typeof d["render"] !== "function") {
    return "render must be a function";
  }

  const order = d["order"];
  if (order !== undefined) {
    if (typeof order !== "number" || !Number.isFinite(order) || order < MIN_PANEL_ORDER) {
      return "order must be a non-negative finite number";
    }
  }

  const tickMs = d["tickMs"];
  if (tickMs !== undefined) {
    if (typeof tickMs !== "number" || !Number.isFinite(tickMs) || tickMs <= 0) {
      return "tickMs must be a positive finite number";
    }
  }

  const maxLines = d["maxLines"];
  if (maxLines !== undefined) {
    if (typeof maxLines !== "number" || !Number.isInteger(maxLines) || maxLines < MIN_PANEL_MAX_LINES) {
      return `maxLines must be an integer >= ${MIN_PANEL_MAX_LINES}`;
    }
  }

  const replaces = d["replaces"];
  if (replaces !== undefined) {
    if (typeof replaces !== "string" || replaces.length === 0) {
      return "replaces must be a non-empty string";
    }
  }

  return null;
}