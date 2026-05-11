import { useState, type DragEvent } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';
import { useTemplateStore } from '../store/template-store';
import { TEMPLATE_DRAG_MIME, type NodeTemplate } from '../types/templates';
import TemplateNameDialog from './TemplateNameDialog';

function relativeTimestamp(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface TemplateItemProps {
  template: NodeTemplate;
  onInsert: (template: NodeTemplate) => void;
  onDelete: (template: NodeTemplate) => void;
}

function TemplateItem({ template, onInsert, onDelete }: TemplateItemProps) {
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(TEMPLATE_DRAG_MIME, template.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group/tpl flex cursor-grab items-center gap-2 rounded-lg border border-stone-300 bg-white/60 px-2.5 py-2 text-stone-700 transition hover:border-violet-400 hover:bg-violet-50 active:cursor-grabbing"
      title={template.description || 'Drag onto the canvas to insert'}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
        <Layers size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-800">
          {template.name}
        </div>
        <div className="text-[10px] text-stone-500">
          {template.nodes.length} node{template.nodes.length === 1 ? '' : 's'}
          {' · '}
          {relativeTimestamp(template.createdAt)}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onInsert(template);
        }}
        title="Insert into canvas"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 opacity-0 transition hover:bg-violet-100 hover:text-violet-700 group-hover/tpl:opacity-100"
      >
        <Plus size={14} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(template);
        }}
        title="Delete template"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 opacity-0 transition hover:bg-red-100 hover:text-red-600 group-hover/tpl:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function TemplatesPanel() {
  const templates = useTemplateStore((s) => s.templates);
  const addTemplate = useTemplateStore((s) => s.addTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const buildTemplateFromSelection = useGraphStore(
    (s) => s.buildTemplateFromSelection,
  );
  const insertTemplate = useGraphStore((s) => s.insertTemplate);
  const getSelectedNodes = useGraphStore((s) => s.getSelectedNodes);
  const nodes = useGraphStore((s) => s.nodes);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<ReturnType<
    typeof buildTemplateFromSelection
  > | null>(null);

  // Re-read selection at click time, but we also subscribe to `nodes` so
  // the button label updates as selection toggles.
  const selectedCount = nodes.filter(
    (n) => (n as { selected?: boolean }).selected,
  ).length;

  const handleSaveClick = () => {
    const payload = buildTemplateFromSelection();
    if (!payload) {
      window.alert(
        'Select one or more nodes on the canvas first (shift+click or drag a box) to save them as a template.',
      );
      return;
    }
    setPendingPayload(payload);
    setDialogOpen(true);
  };

  const handleConfirm = (name: string, description: string) => {
    if (!pendingPayload) return;
    addTemplate({
      name,
      description,
      nodes: pendingPayload.nodes,
      edges: pendingPayload.edges,
    });
    setPendingPayload(null);
    setDialogOpen(false);
  };

  const handleCancel = () => {
    setPendingPayload(null);
    setDialogOpen(false);
  };

  const handleInsert = (template: NodeTemplate) => {
    insertTemplate(template);
  };

  const handleDelete = (template: NodeTemplate) => {
    if (
      window.confirm(
        `Delete template "${template.name}"? This cannot be undone.`,
      )
    ) {
      deleteTemplate(template.id);
    }
  };

  // Suppress unused-var warning when nothing is selected.
  void getSelectedNodes;

  return (
    <div className="border-t border-stone-200 px-[14px] pb-3 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          Templates
        </h3>
        {selectedCount > 0 && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
            {selectedCount} selected
          </span>
        )}
      </div>

      <button
        onClick={handleSaveClick}
        disabled={selectedCount === 0}
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white/60 px-2 py-2 text-xs font-medium text-stone-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-stone-300 disabled:hover:bg-white/60 disabled:hover:text-stone-700"
        title={
          selectedCount === 0
            ? 'Select nodes on the canvas to enable'
            : `Save ${selectedCount} selected node${selectedCount === 1 ? '' : 's'} as a reusable template`
        }
      >
        <Plus size={14} />
        Save selection as template
      </button>

      {templates.length === 0 ? (
        <p className="px-1 py-1 text-[10px] leading-relaxed text-stone-500">
          Saved groups appear here. Select nodes on the canvas, then click
          the button above to save them.
        </p>
      ) : (
        <div className="space-y-1.5">
          {templates.map((tpl) => (
            <TemplateItem
              key={tpl.id}
              template={tpl}
              onInsert={handleInsert}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {dialogOpen && (
        <TemplateNameDialog
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
