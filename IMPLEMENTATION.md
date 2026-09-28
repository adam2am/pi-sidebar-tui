# Panel Protocol v1 — implementation notes

Status: **layers 1–3 complete and green; layer 4 (full builtin state extraction)
deferred.** Nothing is committed — the tree is left in a coherent, tested state.

## What was built

### Layer 1 — public contract + registry (`api.ts`, `registry.ts`)
- `api.ts` — the entire public contract, **zero pi imports**: `PANEL_PROTOCOL`,
  the `CH` channel map (`register` / `unregister` / `invalidate` / `ready`),
  `PanelDescriptor`, `PanelRenderCtx`, `PanelEntry`, `PanelSource`,
  `PanelUserOverride`, `RegisterOutcome`, and a real `validatePanelDescriptor()`
  (id/title/render presence and types, non-negative finite `order`, positive
  `tickMs`, integer `maxLines >= 1`, non-empty `replaces`). Named constants
  replace magic numbers (`DEFAULT_PANEL_ORDER`, `MIN_PANEL_ORDER`,
  `MIN_PANEL_MAX_LINES`).
- `registry.ts` — pure TypeScript, no pi-runtime imports (only
  `truncateToWidth` from `@earendil-works/pi-tui`, which the tests already load).
  `createPanelRegistry()` → `register` / `unregister` / `list` / `renderAll` /
  `setUserOverride` / `tick` / `getFrame`.
  - upsert-by-id (idempotent, O(1)) with a warning when the title changes;
  - cached sorted render-list, rebuilt only on register/unregister/override and
    sorted by effective `order`, ties broken by registration sequence;
  - fault isolation: a throw or non-`string[]` return yields `⚠ <title> failed`,
    bumps `failCount`, and a circuit breaker auto-disables after
    `BREAKER_THRESHOLD = 3` **consecutive** failures (a success resets it);
  - `[]` hides a panel (no separator), `maxLines` slices, lines are
    width-clamped with `truncateToWidth`, panels joined by one blank line —
    the exact behaviour the old `sidebar.ts` hardcoded;
  - `replaces` suppresses the panel whose id is named.

### Layer 2 — bus wiring (`bus-wiring.ts`, `index.ts`)
- `bus-wiring.ts` — transport half, no pi imports, driven by an
  `EventBusLike` structural type. `installBusWiring({ events, registry,
  requestRender, notify })` attaches `CH.register` / `CH.unregister` /
  `CH.invalidate` listeners, rejects malformed payloads to `notify` (registry
  untouched), and exposes `announceReady()` / `dispose()`.
- `index.ts` wires it **at extension eval time** (top of the default export,
  not in `session_start`): creates the registry, registers the builtins, applies
  panel overrides, installs the listeners, and emits `CH.ready`
  (`{ protocol: 1 }`) at eval and again after every `session_start`.
  `CH.invalidate` routes into the existing coalesced `requestRender`.

### Layer 3 — debug command + config overlay (`index.ts`, `config.ts`)
- `/sidebar-tui panels` lists every panel: id, title, source, effective order,
  enabled, `lastError`, `failCount`.
- `config.ts`: `SidebarSettings.panels?: Record<string, PanelSettings>`, parsed
  and field-validated in `loadSidebarSettings` (same style as the existing
  fields), applied via `registry.setUserOverride` on load and on settings change.
- ID collision with a different title → `ui.notify` warning.

## Deferred — layer 4

The sizing note allowed stopping at a stable point. **Layer 4 (full builtin
extraction) is deferred:**
- `builtins.ts` registers the four builtins (`pi-sidebar.session` / `.mcp` /
  `.todos` / `.workspace`, orders 10/20/30/40) as registry descriptors, but each
  descriptor still reads the shared `SidebarContext` lazily through `getCtx`.
  The ~35 module-level `let`s and `buildSidebarContext` therefore still live in
  `index.ts`; ownership was **not** moved into per-panel modules.
- **Sidebar-owned ticks are deferred with it**: no builtin declares `tickMs`
  yet, so the caveman/activity `setInterval`s remain standalone in `index.ts`.
  The `tickMs` field, `PanelRenderCtx.frame`, and `registry.tick()` are already
  in place, so the follow-up is: give the session panel a `tickMs`, drive its
  animation off `ctx.frame`, schedule one interval per distinct active `tickMs`
  in `index.ts`, and delete the two standalone timers.
- Todo-sniffing already lives only in the builtin todos path and is suppressed
  when an external panel registers with `replaces: "pi-sidebar.todos"`
  (covered by the registry test).

`sidebar.ts` is already thin: `renderSidebar(ctx, width, registry?)` delegates to
`registry.renderAll` in production and falls back to a builtin-only registry for
the legacy/test 2-arg call.

## Consumer registration (3 lines)

```ts
import { CH, type PanelDescriptor } from "pi-sidebar-tui/api.ts";
const descriptor: PanelDescriptor = { id: "acme.todo", title: "Todo", render: () => ["hi"] };
pi.events.on(CH.ready, () => pi.events.emit(CH.register, descriptor));
```

## Tests

`npm test` (fixed: the glob was single-quoted, which cmd/PowerShell passed
literally and produced **0 tests** on Windows — the quotes are removed):

```
tests 169   pass 169   fail 0
```

- `tests/registry.test.ts` — **29 pass** (validation matrix, upsert, ordering,
  hidden/maxLines/replaces, fault isolation + breaker at exactly 3, non-string[]
  failure, user overrides).
- `tests/bus.test.ts` — **12 pass** (register/unregister/invalidate/READY flows,
  malformed payloads → notify + registry unchanged, reload sequencing with a
  fake `EventBus`, dispose, no shared state).
- `tests/config.test.ts` — +4 panels-overlay tests.
- Existing `tests/panels.test.ts` (65) and `tests/sidebar.test.ts` (5) unchanged
  and still pass — imports were not changed.

No `as any` in any new production file (`api.ts`, `registry.ts`, `bus-wiring.ts`,
`builtins.ts`, `sidebar.ts`, `config.ts`). The one assertion in `bus-wiring.ts`
(`data as PanelDescriptor`) is a plain cast after runtime validation, not
`as any`.

## Uncommitted

All changes are left uncommitted for review:
new — `api.ts`, `registry.ts`, `bus-wiring.ts`, `builtins.ts`,
`tests/registry.test.ts`, `tests/bus.test.ts`, `IMPLEMENTATION.md`;
modified — `index.ts`, `sidebar.ts`, `config.ts`, `compositor.ts`,
`tests/config.test.ts`, `package.json`.