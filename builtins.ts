/**
 * Builtin sidebar panels, expressed as registry descriptors.
 *
 * Each descriptor reads the shared SidebarContext lazily via `getCtx`, so the
 * existing render functions stay unchanged (pure refactor of ownership, not
 * pixels). Full per-panel state ownership (layer 4) is deferred — see
 * IMPLEMENTATION.md.
 */
import type { PanelDescriptor } from "./api.ts";
import type { PanelRegistry } from "./registry.ts";
import type { SidebarContext } from "./types.ts";
import { renderSessionPanel } from "./panels/session.ts";
import { renderMcpPanel } from "./panels/mcp.ts";
import { renderTodosPanel } from "./panels/todos.ts";
import { renderWorkspacePanel } from "./panels/workspace.ts";

/** Builtin render orders (external panels default to 100 and render after). */
const ORDER_SESSION = 10;
const ORDER_MCP = 20;
const ORDER_TODOS = 30;
const ORDER_WORKSPACE = 40;

export const BUILTIN_SESSION_ID = "pi-sidebar.session";
export const BUILTIN_MCP_ID = "pi-sidebar.mcp";
export const BUILTIN_TODOS_ID = "pi-sidebar.todos";
export const BUILTIN_WORKSPACE_ID = "pi-sidebar.workspace";

type PanelRenderer = (ctx: SidebarContext, width: number) => string[];

function descriptor(
  id: string,
  title: string,
  order: number,
  getCtx: () => SidebarContext,
  renderPanel: PanelRenderer,
): PanelDescriptor {
  return {
    id,
    title,
    order,
    render: (_ctx, width) => renderPanel(getCtx(), width),
  };
}

/** The four builtin panel descriptors, bound to a context provider. */
export function builtinPanelDescriptors(getCtx: () => SidebarContext): PanelDescriptor[] {
  return [
    descriptor(BUILTIN_SESSION_ID, "Session", ORDER_SESSION, getCtx, renderSessionPanel),
    descriptor(BUILTIN_MCP_ID, "MCP", ORDER_MCP, getCtx, renderMcpPanel),
    descriptor(BUILTIN_TODOS_ID, "Todos", ORDER_TODOS, getCtx, renderTodosPanel),
    descriptor(BUILTIN_WORKSPACE_ID, "Workspace", ORDER_WORKSPACE, getCtx, renderWorkspacePanel),
  ];
}

/** Register the builtins into a registry, tagged as `builtin`. */
export function registerBuiltinPanels(
  registry: PanelRegistry,
  getCtx: () => SidebarContext,
): void {
  for (const d of builtinPanelDescriptors(getCtx)) registry.register(d, "builtin");
}