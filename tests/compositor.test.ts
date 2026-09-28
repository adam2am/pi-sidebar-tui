import test from "node:test";
import assert from "node:assert/strict";
import { SidebarCompositor } from "../compositor.ts";
import { createPanelRegistry, type PanelRegistry } from "../registry.ts";
import type { SidebarContext } from "../types.ts";

// Regression gates for the scroll-wipe bug: pi-tui emits "\r\n" scroll-appends
// at the bottom screen row during streaming/tool output, scrolling the FULL
// terminal width (sidebar columns included). The compositor's diff cache models
// content, not screen state, so any LF inside a wrapped doRender frame must
// force a full sidebar repaint. These tests pin that contract plus the diff
// cache's cost guard, using hermetic fakes (no terminal, no pi runtime).

const ROWS = 30;
const COLS = 100;
const SW = 20;
const SEP_COL = COLS - SW; // separator column painted per repainted row

function makeCtx(): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
    todosMax: 10,
    branch: null,
    aheadCount: 0,
    untrackedCount: 0,
    workspaceFiles: [],
    cwd: undefined,
    model: null,
    thinkingLevel: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    sessionCost: 0,
    turnCount: 0,
    activeTool: null,
    autoCompactEnabled: null,
    sessionStartMs: 0,
    mcpServers: [],
    modelProvider: null,
    cavemanLevel: null,
    cavemanFrame: 0,
    agentActive: false,
    spinnerFrame: 0,
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    ctxSamples: [],
  };
}

interface Rig {
  tui: { terminal: FakeTerminal; doRender(payload?: string): void };
  terminal: FakeTerminal;
  registry: PanelRegistry;
  comp: SidebarCompositor;
  /** Returns accumulated writes since the last drain and clears the buffer. */
  drain(): string;
}

interface FakeTerminal {
  rows: number;
  columns: number;
  write(data: string): void;
}

function makeRig(ctx: SidebarContext): Rig {
  const writes: string[] = [];
  const terminal: FakeTerminal = {
    rows: ROWS,
    columns: COLS,
    write(data: string) {
      writes.push(data);
    },
  };
  const tui = {
    terminal,
    doRender(payload = "") {
      terminal.write(payload);
    },
  };
  const registry = createPanelRegistry();
  const comp = new SidebarCompositor(tui, () => ctx, SW, registry);
  comp.install();
  return {
    tui,
    terminal,
    registry,
    comp,
    drain() {
      const out = writes.join("");
      writes.length = 0;
      return out;
    },
  };
}

/** Each repainted sidebar row emits one CUP to the separator column. */
function countSidebarPaints(frame: string): number {
  return frame.split("\x1b[").filter((frag) => frag.endsWith(`;${SEP_COL}H`)).length;
}

test("LF in a wrapped frame forces a full sidebar repaint (scroll-wipe regression gate)", () => {
  const rig = makeRig(makeCtx());
  rig.tui.doRender("hello"); // primes the diff cache (first paint is full)
  rig.drain();

  rig.tui.doRender("new\r\nline"); // LF = potential full-width scroll
  assert.equal(countSidebarPaints(rig.drain()), ROWS);

  rig.comp.dispose();
});

test("no LF + unchanged ctx repaints nothing (diff-cache cost guard)", () => {
  const rig = makeRig(makeCtx());
  rig.tui.doRender("x");
  rig.drain();

  rig.tui.doRender("x");
  assert.equal(countSidebarPaints(rig.drain()), 0);

  rig.comp.dispose();
});

test("no LF + changed content repaints exactly the changed row", () => {
  const ctx = makeCtx();
  const rig = makeRig(ctx);
  rig.registry.register({
    id: "test.echo",
    title: "Echo",
    render: () => [ctx.sessionTitle ?? "none"],
  });

  rig.tui.doRender("a");
  rig.drain();

  ctx.sessionTitle = "changed";
  rig.tui.doRender("b");
  assert.equal(countSidebarPaints(rig.drain()), 1);

  rig.comp.dispose();
});

test("2J full-clear still forces a full repaint (pre-existing detection intact)", () => {
  const rig = makeRig(makeCtx());
  rig.tui.doRender("hello");
  rig.drain();

  rig.tui.doRender("\x1b[2J\x1b[H");
  assert.equal(countSidebarPaints(rig.drain()), ROWS);

  rig.comp.dispose();
});

test("\\r and \\n split across two writes in one frame still force a full repaint", () => {
  const writes: string[] = [];
  const terminal: FakeTerminal = {
    rows: ROWS,
    columns: COLS,
    write(data: string) {
      writes.push(data);
    },
  };
  const tui = {
    terminal,
    doRender() {
      terminal.write("a\r"); // chunk 1: lone CR
      terminal.write("\nb"); // chunk 2: lone LF (BoundedTerminalWriter split class)
    },
  };
  const comp = new SidebarCompositor(tui, () => makeCtx(), SW, createPanelRegistry());
  comp.install();

  tui.doRender(); // prime
  writes.length = 0;

  tui.doRender();
  const frame = writes.join("");
  assert.equal(countSidebarPaints(frame), ROWS);

  comp.dispose();
});

test("standalone paint() after an LF frame is a no-op, dispose() restores columns", () => {
  const rig = makeRig(makeCtx());
  rig.tui.doRender("scroll\r\n"); // full repaint leaves a coherent cache
  rig.drain();

  rig.comp.paint();
  assert.equal(countSidebarPaints(rig.drain()), 0);

  rig.comp.dispose();
  assert.equal(rig.terminal.columns, COLS); // original descriptor restored
});
