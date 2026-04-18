import { defineTool } from '../../tool-module';
import { createCanvaTool, type CanvaToolContext } from './canva';

/**
 * Canva — ephemeral HTML/CSS/JS visualization server. Returns null
 * when no workspace directory is configured.
 */
export default defineTool<CanvaToolContext & { enabled: boolean }>({
  name: 'canva',
  label: 'Canva',
  description: 'Render HTML/CSS/JS visualizations in an ephemeral local server',
  group: 'media',
  icon: 'layout-dashboard',
  classification: 'state-mutating',

  resolveContext: (config, runtime) => ({
    enabled: Boolean(runtime.cwd),
    cwd: runtime.cwd ?? '',
    sandboxWorkdir: runtime.sandboxWorkdir,
    portRangeStart: config.canvaPortRangeStart,
    portRangeEnd: config.canvaPortRangeEnd,
  }),

  create: (ctx) => {
    if (!ctx.enabled) return null;
    return createCanvaTool({
      cwd: ctx.cwd,
      sandboxWorkdir: ctx.sandboxWorkdir,
      portRangeStart: ctx.portRangeStart,
      portRangeEnd: ctx.portRangeEnd,
    });
  },
});
