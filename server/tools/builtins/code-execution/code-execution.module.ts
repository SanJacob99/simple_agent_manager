import { defineTool } from '../../tool-module';
import { createCodeExecutionTool } from './code-execution';

interface CodeExecutionModuleContext {
  apiKey?: string;
  model?: string;
}

/**
 * Sandboxed Python execution via xAI. Returns null when no xAI key
 * is configured — the tool can't function without one.
 */
export default defineTool<CodeExecutionModuleContext>({
  name: 'code_execution',
  label: 'Code Execution',
  description: 'Run sandboxed Python on xAI — for calculations, statistics, data analysis',
  group: 'coding',
  icon: 'code',
  classification: 'state-mutating',

  resolveContext: (config) => ({
    apiKey: config.xaiApiKey || process.env.XAI_API_KEY,
    model: config.xaiModel,
  }),

  create: (ctx) => {
    if (!ctx.apiKey) return null;
    return createCodeExecutionTool({ apiKey: ctx.apiKey, model: ctx.model });
  },
});
