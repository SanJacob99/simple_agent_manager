import type { ProviderPluginDefinition } from '../../../shared/plugin-sdk';
import { openrouterPlugin } from './openrouter';

/**
 * Static loader map — every plugin must be imported here so that
 * both tsx dev and compiled JS builds can resolve them.
 */
export const PLUGIN_MAP: Record<string, ProviderPluginDefinition> = {
  openrouter: openrouterPlugin,
};
