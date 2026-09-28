/**
 * Panel registry — pure TypeScript, no pi-runtime imports (only the width
 * truncation helper, which tests already load). Testable in isolation.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  DEFAULT_PANEL_ORDER,
  validatePanelDescriptor,
  type PanelDescriptor,
  type PanelEntry,
  type PanelRenderCtx,
  type PanelSource,
  type PanelUserOverride,
  type RegisterOutcome,
} from "./api.ts";

/** Consecutive render failures before a panel is auto-disabled. */
const BREAKER_THRESHOLD = 3;

/** Placeholder row shown when a panel throws or returns a non-string[]. */
const FAILURE_GLYPH = "\u26a0"; // ⚠

interface Entry {
  descriptor: PanelDescriptor;
  /** Registration sequence — tie-breaker when orders are equal. */
  seq: number;
  source: PanelSource;
  failCount: number;
  lastError: string | null;
  breakerOpen: boolean;
}

export interface PanelRegistry {
  /** Validate + upsert by id. Never throws. */
  register(descriptor: PanelDescriptor, source?: PanelSource): RegisterOutcome;
  /** Remove a panel by id. Returns whether it existed. */
  unregister(id: string): boolean;
  /** Snapshot in effective render order (for the debug listing). */
  list(): PanelEntry[];
  /** Render visible panels, joined by a blank line, each line width-clamped. */
  renderAll(width: number, frame: number): string[];
  /** Apply a per-panel user config overlay (enable/order/maxLines). */
  setUserOverride(id: string, override: PanelUserOverride): void;
  /** Advance the animation frame counter. Returns the new frame. */
  tick(): number;
  /** Current frame counter (what renderAll should be given). */
  getFrame(): number;
}

export function createPanelRegistry(): PanelRegistry {
  const entries = new Map<string, Entry>();
  const overrides = new Map<string, PanelUserOverride>();
  let seq = 0;
  let frame = 0;
  let ordered: Entry[] | null = null; // cached sorted list, rebuilt lazily

  const effectiveOrder = (e: Entry): number =>
    overrides.get(e.descriptor.id)?.order ?? e.descriptor.order ?? DEFAULT_PANEL_ORDER;

  const isSuppressed = (e: Entry): boolean =>
    e.breakerOpen || overrides.get(e.descriptor.id)?.enabled === false;

  function orderedEntries(): Entry[] {
    if (ordered) return ordered;
    ordered = [...entries.values()].sort((a, b) => {
      const d = effectiveOrder(a) - effectiveOrder(b);
      return d !== 0 ? d : a.seq - b.seq;
    });
    return ordered;
  }

  /** Ids named by any registered panel's `replaces` — those panels are hidden. */
  function suppressedIds(): Set<string> {
    const set = new Set<string>();
    for (const e of entries.values()) {
      if (e.descriptor.replaces) set.add(e.descriptor.replaces);
    }
    return set;
  }

  function recordFailure(e: Entry, error: unknown): string[] {
    e.failCount += 1;
    e.lastError = error instanceof Error ? error.message : String(error);
    if (e.failCount >= BREAKER_THRESHOLD) e.breakerOpen = true;
    return [`${FAILURE_GLYPH} ${e.descriptor.title} failed`];
  }

  function renderEntry(e: Entry, frameValue: number, width: number): string[] {
    const ctx: PanelRenderCtx = { frame: frameValue };
    let lines: unknown;
    try {
      lines = e.descriptor.render(ctx, width);
    } catch (error) {
      return recordFailure(e, error);
    }
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) {
      return recordFailure(e, new Error("render() must return string[]"));
    }
    e.failCount = 0;
    e.lastError = null;
    const cap = overrides.get(e.descriptor.id)?.maxLines ?? e.descriptor.maxLines;
    return typeof cap === "number" ? lines.slice(0, cap) : lines;
  }

  return {
    register(descriptor, source = "external") {
      const reason = validatePanelDescriptor(descriptor);
      if (reason !== null) return { ok: false, reason };

      const existing = entries.get(descriptor.id);
      if (existing) {
        const warning = existing.descriptor.title !== descriptor.title
          ? `panel "${descriptor.id}" re-registered with a different title `
            + `("${existing.descriptor.title}" -> "${descriptor.title}")`
          : undefined;
        existing.descriptor = descriptor;
        existing.failCount = 0;
        existing.lastError = null;
        existing.breakerOpen = false;
        ordered = null;
        return { ok: true, ...(warning ? { warning } : {}) };
      }

      entries.set(descriptor.id, {
        descriptor,
        seq: seq++,
        source,
        failCount: 0,
        lastError: null,
        breakerOpen: false,
      });
      ordered = null;
      return { ok: true };
    },

    unregister(id) {
      const removed = entries.delete(id);
      if (removed) ordered = null;
      return removed;
    },

    list() {
      const suppressed = suppressedIds();
      return orderedEntries().map((e): PanelEntry => ({
        id: e.descriptor.id,
        title: e.descriptor.title,
        order: effectiveOrder(e),
        tickMs: e.descriptor.tickMs,
        enabled: !isSuppressed(e) && !suppressed.has(e.descriptor.id),
        source: e.source,
        lastError: e.lastError,
        failCount: e.failCount,
      }));
    },

    renderAll(width, frameValue) {
      const safeWidth = Math.max(1, width);
      const suppressed = suppressedIds();
      const out: string[] = [];
      for (const e of orderedEntries()) {
        if (isSuppressed(e) || suppressed.has(e.descriptor.id)) continue;
        const lines = renderEntry(e, frameValue, safeWidth);
        if (lines.length === 0) continue;
        if (out.length > 0) out.push("");
        for (const line of lines) {
          out.push(truncateToWidth(line, safeWidth, "", true));
        }
      }
      return out;
    },

    setUserOverride(id, override) {
      overrides.set(id, { ...overrides.get(id), ...override });
      ordered = null;
    },

    tick() {
      frame += 1;
      return frame;
    },

    getFrame() {
      return frame;
    },
  };
}