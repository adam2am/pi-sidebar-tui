import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PANEL_ORDER,
  validatePanelDescriptor,
  type PanelDescriptor,
} from "../api.ts";
import { createPanelRegistry } from "../registry.ts";

function make(over: Partial<PanelDescriptor> = {}): PanelDescriptor {
  return {
    id: "test.panel",
    title: "Panel",
    render: () => ["line"],
    ...over,
  };
}

// Lines are padded to the requested width (pad=true, matching sidebar.ts), so
// strip ANSI + trailing padding before comparing.
function plain(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
}

// ─── validation matrix ────────────────────────────────────────────────────────

test("validate: rejects non-objects", () => {
  assert.notEqual(validatePanelDescriptor(null), null);
  assert.notEqual(validatePanelDescriptor(undefined), null);
  assert.notEqual(validatePanelDescriptor("panel"), null);
  assert.notEqual(validatePanelDescriptor(42), null);
});

test("validate: rejects missing/empty id", () => {
  assert.match(validatePanelDescriptor({})!, /id/);
  assert.match(validatePanelDescriptor({ id: "", title: "t", render: () => [] })!, /id/);
  assert.match(validatePanelDescriptor({ id: 7, title: "t", render: () => [] })!, /id/);
});

test("validate: rejects missing/empty title", () => {
  assert.match(validatePanelDescriptor({ id: "a.b" })!, /title/);
  assert.match(validatePanelDescriptor({ id: "a.b", title: "" })!, /title/);
  assert.match(validatePanelDescriptor({ id: "a.b", title: 3, render: () => [] })!, /title/);
});

test("validate: rejects missing/non-function render", () => {
  assert.match(validatePanelDescriptor({ id: "a.b", title: "t" })!, /render/);
  assert.match(validatePanelDescriptor({ id: "a.b", title: "t", render: "nope" })!, /render/);
});

test("validate: rejects negative / non-finite order", () => {
  assert.match(validatePanelDescriptor({ ...make(), order: -1 })!, /order/);
  assert.match(validatePanelDescriptor({ ...make(), order: Number.NaN })!, /order/);
  assert.match(validatePanelDescriptor({ ...make(), order: Number.POSITIVE_INFINITY })!, /order/);
});

test("validate: rejects tickMs <= 0", () => {
  assert.match(validatePanelDescriptor({ ...make(), tickMs: 0 })!, /tickMs/);
  assert.match(validatePanelDescriptor({ ...make(), tickMs: -90 })!, /tickMs/);
});

test("validate: rejects maxLines < 1 and non-integers", () => {
  assert.match(validatePanelDescriptor({ ...make(), maxLines: 0 })!, /maxLines/);
  assert.match(validatePanelDescriptor({ ...make(), maxLines: -3 })!, /maxLines/);
  assert.match(validatePanelDescriptor({ ...make(), maxLines: 2.5 })!, /maxLines/);
});

test("validate: accepts a well-formed descriptor", () => {
  assert.equal(validatePanelDescriptor(make()), null);
  assert.equal(validatePanelDescriptor(make({ order: 0, tickMs: 90, maxLines: 5, replaces: "x.y" })), null);
});

// ─── registration ─────────────────────────────────────────────────────────────

test("register: invalid descriptor is rejected with a reason and not stored", () => {
  const reg = createPanelRegistry();
  const outcome = reg.register({ id: "", title: "x", render: () => [] });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.ok === false && outcome.reason.length > 0);
  assert.equal(reg.list().length, 0);
});

test("register: upsert by id is idempotent and updates the descriptor", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a.b", title: "One" }), "builtin");
  const second = reg.register(make({ id: "a.b", title: "Two" }), "external");

  assert.equal(reg.list().length, 1);
  assert.equal(reg.list()[0]!.title, "Two");
  // source is preserved from first registration
  assert.equal(reg.list()[0]!.source, "builtin");
  assert.equal(second.ok && second.warning !== undefined, true);
  assert.equal(reg.list()[0]!.failCount, 0);
});

test("register: same-title reload produces no warning", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a.b", title: "Same" }));
  const outcome = reg.register(make({ id: "a.b", title: "Same" }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.warning, undefined);
});

test("unregister: removes the panel", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a.b" }));
  assert.equal(reg.unregister("a.b"), true);
  assert.equal(reg.unregister("a.b"), false);
  assert.equal(reg.list().length, 0);
});

// ─── ordering ─────────────────────────────────────────────────────────────────

test("ordering: lower order renders first, default is DEFAULT_PANEL_ORDER", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "c", title: "C", render: () => ["C"] }));
  reg.register(make({ id: "a", title: "A", order: 10, render: () => ["A"] }));
  reg.register(make({ id: "b", title: "B", order: 20, render: () => ["B"] }));

  assert.deepEqual(plain(reg.renderAll(40, 0)), ["A", "", "B", "", "C"]);
  assert.equal(reg.list().map((e) => e.id).at(-1), "c");
  assert.equal(DEFAULT_PANEL_ORDER, 100);
});

test("ordering: equal order breaks by registration sequence", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "first", render: () => ["1"] }));
  reg.register(make({ id: "second", render: () => ["2"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["1", "", "2"]);
});

test("ordering: re-register keeps the original sequence in a tie", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "first", render: () => ["1"] }));
  reg.register(make({ id: "second", render: () => ["2"] }));
  reg.register(make({ id: "first", render: () => ["1b"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["1b", "", "2"]);
});

// ─── rendering ────────────────────────────────────────────────────────────────

test("renderAll: [] hides a panel and adds no separator", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a", order: 10, render: () => ["A"] }));
  reg.register(make({ id: "hidden", order: 20, render: () => [] }));
  reg.register(make({ id: "b", order: 30, render: () => ["B"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["A", "", "B"]);
});

test("renderAll: enforces maxLines by slicing", () => {
  const reg = createPanelRegistry();
  reg.register(make({ maxLines: 2, render: () => ["1", "2", "3", "4"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["1", "2"]);
});

test("renderAll: truncates every line to width", () => {
  const reg = createPanelRegistry();
  reg.register(make({ render: () => ["x".repeat(200)] }));
  const out = plain(reg.renderAll(10, 0));
  assert.equal(out.length, 1);
  assert.ok(out[0]!.length <= 10, `line too wide: ${out[0]!.length}`);
});

test("renderAll: passes the frame through to render", () => {
  const reg = createPanelRegistry();
  let seen = -1;
  reg.register(make({ render: (ctx) => { seen = ctx.frame; return ["x"]; } }));
  reg.renderAll(40, 7);
  assert.equal(seen, 7);
  assert.equal(reg.getFrame(), 0);
  assert.equal(reg.tick(), 1);
  assert.equal(reg.getFrame(), 1);
});

// ─── replaces ─────────────────────────────────────────────────────────────────

test("replaces: a panel named by another's replaces is suppressed", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "pi-sidebar.todos", title: "Todos", order: 30, render: () => ["BUILTIN"] }), "builtin");
  reg.register(make({ id: "ext.todos", title: "Todos+", order: 30, replaces: "pi-sidebar.todos", render: () => ["EXTERNAL"] }));

  assert.deepEqual(plain(reg.renderAll(40, 0)), ["EXTERNAL"]);
  const builtin = reg.list().find((e) => e.id === "pi-sidebar.todos");
  assert.equal(builtin?.enabled, false);
});

// ─── fault isolation + circuit breaker ────────────────────────────────────────

test("fault isolation: a throwing panel shows a placeholder, siblings render", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "bad", order: 10, title: "Bad", render: () => { throw new Error("boom"); } }));
  reg.register(make({ id: "good", order: 20, render: () => ["GOOD"] }));

  const out = plain(reg.renderAll(40, 0));
  assert.deepEqual(out, ["⚠ Bad failed", "", "GOOD"]);
  assert.equal(reg.list().find((e) => e.id === "bad")?.lastError, "boom");
});

test("fault isolation: non-string[] return is treated as failure", () => {
  const reg = createPanelRegistry();
  reg.register(make({
    title: "Weird",
    render: (() => ["ok", 5]) as unknown as PanelDescriptor["render"],
  }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["⚠ Weird failed"]);
  assert.equal(reg.list()[0]!.failCount, 1);

  const reg2 = createPanelRegistry();
  reg2.register(make({
    title: "Null",
    render: (() => null) as unknown as PanelDescriptor["render"],
  }));
  assert.deepEqual(plain(reg2.renderAll(40, 0)), ["⚠ Null failed"]);
});

test("breaker trips at exactly 3 consecutive failures", () => {
  const reg = createPanelRegistry();
  let calls = 0;
  reg.register(make({ title: "Flaky", render: () => { calls++; throw new Error("nope"); } }));

  assert.deepEqual(plain(reg.renderAll(40, 0)), ["⚠ Flaky failed"]);
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["⚠ Flaky failed"]);
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["⚠ Flaky failed"]);
  assert.equal(calls, 3);
  assert.equal(reg.list()[0]!.failCount, 3);

  // tripped: no further render attempts, no placeholder
  assert.deepEqual(plain(reg.renderAll(40, 0)), []);
  assert.equal(calls, 3);
  assert.equal(reg.list()[0]!.enabled, false);
});

test("breaker: a success resets the consecutive failure count", () => {
  const reg = createPanelRegistry();
  let shouldFail = true;
  reg.register(make({ title: "Recovers", render: () => {
    if (shouldFail) throw new Error("nope");
    return ["OK"];
  } }));

  reg.renderAll(40, 0);
  reg.renderAll(40, 0);
  assert.equal(reg.list()[0]!.failCount, 2);

  shouldFail = false;
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["OK"]);
  assert.equal(reg.list()[0]!.failCount, 0);
  assert.equal(reg.list()[0]!.lastError, null);

  shouldFail = true;
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["⚠ Recovers failed"]);
  assert.equal(reg.list()[0]!.failCount, 1);
});

test("register: re-registration closes a tripped breaker", () => {
  const reg = createPanelRegistry();
  reg.register(make({ title: "Flaky", render: () => { throw new Error("x"); } }));
  for (let i = 0; i < 3; i++) reg.renderAll(40, 0);
  assert.equal(reg.list()[0]!.enabled, false);

  reg.register(make({ title: "Flaky", render: () => ["FIXED"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["FIXED"]);
  assert.equal(reg.list()[0]!.enabled, true);
});

// ─── user override ────────────────────────────────────────────────────────────

test("userOverride: enabled=false disables a panel", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a", order: 10, render: () => ["A"] }));
  reg.register(make({ id: "b", order: 20, render: () => ["B"] }));
  reg.setUserOverride("a", { enabled: false });

  assert.deepEqual(plain(reg.renderAll(40, 0)), ["B"]);
  assert.equal(reg.list().find((e) => e.id === "a")?.enabled, false);

  reg.setUserOverride("a", { enabled: true });
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["A", "", "B"]);
});

test("userOverride: order re-sorts the render list", () => {
  const reg = createPanelRegistry();
  reg.register(make({ id: "a", order: 10, render: () => ["A"] }));
  reg.register(make({ id: "b", order: 20, render: () => ["B"] }));
  reg.setUserOverride("a", { order: 50 });
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["B", "", "A"]);
  assert.equal(reg.list()[0]!.order, 20);
  assert.equal(reg.list()[1]!.order, 50);
});

test("userOverride: maxLines overrides the descriptor cap", () => {
  const reg = createPanelRegistry();
  reg.register(make({ maxLines: 4, render: () => ["1", "2", "3", "4"] }));
  reg.setUserOverride("test.panel", { maxLines: 1 });
  assert.deepEqual(plain(reg.renderAll(40, 0)), ["1"]);
});

test("userOverride: applies to a panel registered after the override", () => {
  const reg = createPanelRegistry();
  reg.setUserOverride("a", { enabled: false, order: 5 });
  reg.register(make({ id: "a", order: 10, render: () => ["A"] }));
  assert.deepEqual(plain(reg.renderAll(40, 0)), []);
  assert.equal(reg.list()[0]!.order, 5);
});