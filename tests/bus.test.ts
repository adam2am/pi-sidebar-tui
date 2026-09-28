import test from "node:test";
import assert from "node:assert/strict";
import { CH, PANEL_PROTOCOL, type PanelDescriptor } from "../api.ts";
import { createPanelRegistry, type PanelRegistry } from "../registry.ts";
import { installBusWiring, type EventBusLike, type NotifyLevel } from "../bus-wiring.ts";

class FakeBus implements EventBusLike {
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

  emit(channel: string, data: unknown): void {
    for (const handler of [...(this.handlers.get(channel) ?? [])]) handler(data);
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    const registered = set;
    registered.add(handler);
    return () => {
      registered.delete(handler);
    };
  }
}

function harness() {
  const events = new FakeBus();
  const registry = createPanelRegistry();
  const notifications: Array<{ message: string; level: NotifyLevel }> = [];
  let renders = 0;
  const wiring = installBusWiring({
    events,
    registry,
    requestRender: () => { renders++; },
    notify: (message, level) => { notifications.push({ message, level }); },
  });
  return { events, registry, notifications, wiring, renderCount: () => renders };
}

function descriptor(over: Partial<PanelDescriptor> = {}): PanelDescriptor {
  return { id: "ext.panel", title: "External", render: () => ["EXT"], ...over };
}

// ─── register / unregister ────────────────────────────────────────────────────

test("bus: register adds an external panel", () => {
  const h = harness();
  h.events.emit(CH.register, descriptor());
  const entry = h.registry.list()[0];
  assert.equal(entry?.id, "ext.panel");
  assert.equal(entry?.source, "external");
  assert.equal(h.notifications.length, 0);
});

test("bus: malformed register payload notifies and leaves the registry unchanged", () => {
  const h = harness();
  h.registry.register(descriptor({ id: "ext.keep" }));

  h.events.emit(CH.register, null);
  h.events.emit(CH.register, { id: 42, title: "bad" });
  h.events.emit(CH.register, "not a descriptor");

  assert.equal(h.registry.list().length, 1);
  assert.equal(h.notifications.length, 3);
  assert.ok(h.notifications.every((n) => n.level === "warning"));
  assert.match(h.notifications[0]!.message, /rejected/);
});

test("bus: id collision with a different title notifies", () => {
  const h = harness();
  h.events.emit(CH.register, descriptor({ title: "First" }));
  h.events.emit(CH.register, descriptor({ title: "Second" }));
  assert.equal(h.registry.list().length, 1);
  assert.equal(h.registry.list()[0]!.title, "Second");
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0]!.message, /different title/);
});

test("bus: unregister removes the panel", () => {
  const h = harness();
  h.events.emit(CH.register, descriptor());
  h.events.emit(CH.unregister, { id: "ext.panel" });
  assert.equal(h.registry.list().length, 0);
});

test("bus: malformed unregister payload notifies", () => {
  const h = harness();
  h.events.emit(CH.unregister, { id: 9 });
  h.events.emit(CH.unregister, "nope");
  assert.equal(h.notifications.length, 2);
});

// ─── invalidate ───────────────────────────────────────────────────────────────

test("bus: invalidate routes to the coalesced requestRender", () => {
  const h = harness();
  h.events.emit(CH.invalidate, { id: "ext.panel" });
  h.events.emit(CH.invalidate, undefined);
  h.events.emit(CH.invalidate, null);
  assert.equal(h.renderCount(), 3);
  assert.equal(h.notifications.length, 0);
});

test("bus: malformed invalidate payload notifies without repainting", () => {
  const h = harness();
  h.events.emit(CH.invalidate, "panel-id");
  assert.equal(h.renderCount(), 0);
  assert.equal(h.notifications.length, 1);
});

// ─── ready handshake / reload ─────────────────────────────────────────────────

test("bus: announceReady broadcasts the protocol version", () => {
  const h = harness();
  const seen: unknown[] = [];
  h.events.on(CH.ready, (data) => seen.push(data));
  h.wiring.announceReady();
  assert.deepEqual(seen, [{ protocol: PANEL_PROTOCOL }]);
});

test("bus: a panel that emitted before the sidebar listened recovers on READY", () => {
  const events = new FakeBus();
  const panel = descriptor({ id: "ext.early" });

  // Panel registers before the sidebar has attached its listener: the event is
  // dropped (no handler yet).
  events.emit(CH.register, panel);

  const registry = createPanelRegistry();
  const wiring = installBusWiring({
    events,
    registry,
    requestRender: () => {},
    notify: () => {},
  });
  assert.equal(registry.list().length, 0);

  // A well-behaved panel re-registers whenever it sees READY.
  events.on(CH.ready, () => events.emit(CH.register, panel));
  wiring.announceReady();

  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0]!.id, "ext.early");
});

test("bus: READY re-emit never loses a registration regardless of order", () => {
  const panel = descriptor({ id: "ext.order" });

  // Order A: panel listens first, sidebar announces later.
  const a = harness();
  a.events.on(CH.ready, () => a.events.emit(CH.register, panel));
  a.wiring.announceReady();
  assert.equal(a.registry.list().length, 1);

  // Order B: sidebar announces first, panel attaches + self-registers later.
  const b = harness();
  b.wiring.announceReady();
  b.events.on(CH.ready, () => b.events.emit(CH.register, panel));
  b.events.emit(CH.register, panel);
  assert.equal(b.registry.list().length, 1);
});

// ─── dispose ──────────────────────────────────────────────────────────────────

test("bus: dispose detaches every listener", () => {
  const h = harness();
  h.wiring.dispose();

  h.events.emit(CH.register, descriptor());
  h.events.emit(CH.unregister, { id: "ext.panel" });
  h.events.emit(CH.invalidate, {});

  assert.equal(h.registry.list().length, 0);
  assert.equal(h.renderCount(), 0);
  assert.equal(h.notifications.length, 0);
});

test("registry is reusable across harnesses (no shared state)", () => {
  const a: PanelRegistry = createPanelRegistry();
  const b = createPanelRegistry();
  a.register(descriptor({ id: "a" }));
  assert.equal(a.list().length, 1);
  assert.equal(b.list().length, 0);
});