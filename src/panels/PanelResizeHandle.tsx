interface PanelResizeHandleProps {
  onMouseDown: (event: React.MouseEvent) => void;
  title: string;
}

export default function PanelResizeHandle({
  onMouseDown,
  title,
}: PanelResizeHandleProps) {
  return (
    <div
      title={title}
      onMouseDown={onMouseDown}
      className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
    >
      <div className="mx-auto h-full w-px bg-slate-800 transition hover:bg-blue-500" />
    </div>
  );
}
