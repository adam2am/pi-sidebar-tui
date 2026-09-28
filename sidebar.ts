import type { SidebarContext } from "./types.ts";
import { createPanelRegistry, type PanelRegistry } from "./registry.ts";
import { registerBuiltinPanels } from "./builtins.ts";

/**
 * Render the sidebar. With a registry (production) it renders every visible
 * registered panel via `registry.renderAll`; without one it falls back to a
 * throwaway registry containing only the builtins (legacy/test path).
 */
export function renderSidebar(
  ctx: SidebarContext,
  width: number,
  registry?: PanelRegistry,
): string[] {
  const reg = registry ?? builtinOnlyRegistry(ctx);
  return reg.renderAll(Math.max(1, width), reg.getFrame());
}

function builtinOnlyRegistry(ctx: SidebarContext): PanelRegistry {
  const reg = createPanelRegistry();
  registerBuiltinPanels(reg, () => ctx);
  return reg;
}