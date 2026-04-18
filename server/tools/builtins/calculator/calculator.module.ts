import { defineTool } from '../../tool-module';
import { createCalculatorTool } from './calculator';

/**
 * Calculator tool module. No per-agent config, no runtime context —
 * the simplest possible `ToolModule` shape. Good reference for tools
 * that just compute something locally.
 */
export default defineTool<void>({
  name: 'calculator',
  label: 'Calculator',
  description: 'Evaluate a mathematical expression safely.',
  // No group — `calculator` is a standalone utility that users enable
  // individually rather than via a group checkbox.
  icon: 'calculator',
  classification: 'read-only',

  resolveContext: () => undefined,
  create: () => createCalculatorTool(),
});
