/**
 * Panel-protocol bus wiring — the transport half of the registry.
 *
 * Kept free of pi-runtime imports so it can be driven by a fake EventBus in
 * tests. `index.ts` calls `installBusWiring` once at extension eval time.
 */
import { CH, PANEL_PROTOCOL, type PanelDescriptor } from "./api.ts";
import type { PanelRegistry } from "./registry.ts";

/** Structural match for pi's EventBus (see @earendil-works/pi-coding-agent). */
export interface EventBusLike {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export type NotifyLevel = "info" | "warning" | "error";

export interface BusWiringDeps {
  events: EventBusLike;
  registry: PanelRegistry;
  /** Coalesced repaint request (index.ts `requestRender`). */
  requestRender: () => void;
  /** Surface a warning; index.ts routes to ui.notify with a console fallback. */
  notify: (message: string, level: NotifyLevel) => void;
}

export interface BusWiring {
  /** Broadcast protocol readiness so panels (re-)register. Idempotent. */
  announceReady(): void;
  /** Detach all bus listeners. */
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function installBusWiring(deps: BusWiringDeps): BusWiring {
  const { events, registry, requestRender, notify } = deps;

  const onRegister = (data: unknown): void => {
    // Field access happens only after validatePanelDescriptor inside register();
    // the assertion just satisfies the signature (no `as any`).
    const outcome = registry.register(data as PanelDescriptor, "external");
    if (!outcome.ok) {
      notify(`Panel registration rejected: ${outcome.reason}`, "warning");
      return;
    }
    if (outcome.warning) notify(outcome.warning, "warning");
  };

  const onUnregister = (data: unknown): void => {
    const id = isRecord(data) ? data["id"] : undefined;
    if (typeof id !== "string" || id.length === 0) {
      notify("Invalid panel unregister payload (expected { id: string })", "warning");
      return;
    }
    registry.unregister(id);
  };

  const onInvalidate = (data: unknown): void => {
    if (data === undefined || data === null || isRecord(data)) {
      requestRender();
      return;
    }
    notify("Invalid panel invalidate payload (expected { id?: string })", "warning");
  };

  const unsubscribe = [
    events.on(CH.register, onRegister),
    events.on(CH.unregister, onUnregister),
    events.on(CH.invalidate, onInvalidate),
  ];

  const announceReady = (): void => {
    events.emit(CH.ready, { protocol: PANEL_PROTOCOL });
  };

  return {
    announceReady,
    dispose() {
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
    },
  };
}