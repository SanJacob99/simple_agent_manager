import { useState, useRef, useCallback } from 'react';
import { Send, Square, ImagePlus } from 'lucide-react';
import type { ImageAttachment } from '../../shared/protocol';

interface ChatInputProps {
  isStreaming: boolean;
  isBlocked: boolean;
  supportsVision: boolean;
  onSend: (text: string, attachments: ImageAttachment[]) => void;
  onStop: () => void;
}

export default function ChatInput({ isStreaming, isBlocked, supportsVision, onSend, onStop }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || isStreaming || isBlocked) return;
    onSend(input.trim(), attachments);
    setInput('');
    setAttachments([]);
    setPreviews([]);
  }, [input, attachments, isStreaming, isBlocked, onSend]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const [header, data] = dataUrl.split(',');
        const mimeType = header.split(':')[1].split(';')[0];
        setAttachments((prev) => [...prev, { data, mimeType }]);
        setPreviews((prev) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((i: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  return (
    <div className={`border-t border-slate-800 p-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {previews.map((preview, i) => (
            <div key={i} className="relative group">
              <img
                src={preview}
                alt={`attachment ${i + 1}`}
                className="h-14 w-14 rounded object-cover border border-slate-700"
              />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-slate-900 border border-slate-600 text-slate-300 hover:text-white text-[10px]"
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {supportsVision && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageSelect}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || isBlocked}
              className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 transition hover:text-slate-200 hover:border-slate-600 disabled:opacity-50"
              title="Attach images"
            >
              <ImagePlus size={14} />
            </button>
          </>
        )}
        <input
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Type a message..."
          disabled={isStreaming || isBlocked}
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 p-2 text-white transition hover:bg-red-500"
            title="Stop Agent"
          >
            <Square fill="currentColor" size={14} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isBlocked}
            className="rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-500 disabled:opacity-50"
            title="Send Message"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
