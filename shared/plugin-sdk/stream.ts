export type StreamFn = (...args: any[]) => any;

export type ProviderStreamFamily =
  | 'openrouter-thinking'
  | 'openai-responses-defaults'
  | 'google-thinking'
  | 'tool-stream-default-on';

export type ProviderStreamWrapperFactory =
  | ((streamFn: StreamFn | undefined) => StreamFn | undefined)
  | null
  | undefined
  | false;

export interface ProviderWrapStreamFnContext {
  streamFn: StreamFn | undefined;
  thinkingLevel: string;
  modelId: string;
  config?: unknown;
  extraParams?: Record<string, unknown>;
}

export function composeProviderStreamWrappers(
  base: StreamFn | undefined,
  ...wrappers: ProviderStreamWrapperFactory[]
): StreamFn | undefined {
  let current = base;
  for (const wrapper of wrappers) {
    if (typeof wrapper === 'function') {
      current = wrapper(current);
    }
  }
  return current;
}
