/**
 * Public authoring surface for user-installed tools.
 *
 * A user tool at `server/tools/user/<name>/<name>.module.ts` should
 * import everything it needs from this file:
 *
 *     import { defineTool } from '../../sdk';
 *     import type { RuntimeHints } from '../../sdk';
 *
 * Why re-export instead of importing `tool-module` directly? This file
 * is the *stability contract* for user tools. Internal refactors can
 * move `tool-module.ts`, split it, or rename exports without breaking
 * user tools in the wild — as long as the names below keep pointing
 * at something with the same shape.
 *
 * Adding a new export is fine. Renaming or removing an export is a
 * breaking change for every user tool that imports it. See
 * `docs/concepts/user-tools-plan.md` § "Versioning / API stability"
 * before changing this file.
 *
 * When M4 ships a standalone `@simple-agent-manager/tool-sdk` npm
 * package, it will re-export the same names — so switching from
 * `'../../sdk'` to `'@simple-agent-manager/tool-sdk'` will be a
 * find-and-replace.
 */

export { defineTool } from './tool-module';
export type {
  ToolModule,
  ToolClassification,
  RuntimeHints,
  ProviderWebContext,
} from './tool-module';
