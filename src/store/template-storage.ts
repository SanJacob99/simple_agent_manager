import type { NodeTemplate } from '../types/templates';

const STORAGE_KEY = 'agent-manager-node-templates';
const STORAGE_VERSION = 1;

interface PersistedTemplates {
  version: number;
  templates: NodeTemplate[];
}

export function loadTemplates(): NodeTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedTemplates>;
    if (!parsed?.templates || !Array.isArray(parsed.templates)) return [];
    return parsed.templates;
  } catch {
    console.warn('Failed to load node templates');
    return [];
  }
}

export function saveTemplates(templates: NodeTemplate[]): void {
  try {
    const payload: PersistedTemplates = { version: STORAGE_VERSION, templates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    console.warn('Failed to save node templates');
  }
}
