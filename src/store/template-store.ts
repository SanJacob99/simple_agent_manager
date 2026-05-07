import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { NodeTemplate } from '../types/templates';
import { loadTemplates, saveTemplates } from './template-storage';

interface TemplateStore {
  templates: NodeTemplate[];
  /** Add a new template; returns the saved template (with fresh id + timestamp). */
  addTemplate: (
    template: Omit<NodeTemplate, 'id' | 'createdAt'>,
  ) => NodeTemplate;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, name: string) => void;
  /** Returns true if a template with this name (case-insensitive) already exists. */
  isNameTaken: (name: string, excludeId?: string) => boolean;
  getTemplate: (id: string) => NodeTemplate | undefined;
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: loadTemplates(),

  addTemplate: (template) => {
    const saved: NodeTemplate = {
      ...template,
      id: `tpl_${nanoid(10)}`,
      createdAt: Date.now(),
    };
    const next = [...get().templates, saved];
    set({ templates: next });
    saveTemplates(next);
    return saved;
  },

  deleteTemplate: (id) => {
    const next = get().templates.filter((t) => t.id !== id);
    set({ templates: next });
    saveTemplates(next);
  },

  renameTemplate: (id, name) => {
    const next = get().templates.map((t) =>
      t.id === id ? { ...t, name } : t,
    );
    set({ templates: next });
    saveTemplates(next);
  },

  isNameTaken: (name, excludeId) => {
    const lower = name.trim().toLowerCase();
    return get().templates.some(
      (t) => t.id !== excludeId && t.name.toLowerCase() === lower,
    );
  },

  getTemplate: (id) => get().templates.find((t) => t.id === id),
}));
