import { useSettingsStore } from '../settings-store';
import { DEFAULT_CHAT_UI_DEFAULTS } from '../types';

const MIN_RATE = 20;
const MAX_RATE = 400;
const MIN_FADE = 0;
const MAX_FADE = 800;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export default function AppearanceSection() {
  const chatUIDefaults = useSettingsStore((s) => s.chatUIDefaults);
  const setChatUIDefaults = useSettingsStore((s) => s.setChatUIDefaults);

  const { textRevealCharsPerSec, textRevealFadeMs, textRevealEnabled, textRevealStructure } =
    chatUIDefaults;

  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-slate-100">Chat Text Reveal</h3>
          <p className="mt-1 text-sm text-slate-400">
            Controls how assistant messages stream into the chat drawer. Each character
            fades in as it's revealed from the stream buffer.
          </p>
        </header>

        <div className="space-y-6">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-200">Streaming layout</div>
            <div className="space-y-2">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="text-reveal-structure"
                  value="blocks"
                  checked={textRevealStructure === 'blocks'}
                  onChange={() => setChatUIDefaults({ textRevealStructure: 'blocks' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex-1">
                  <span className="block text-sm text-slate-200">Structural (blocks)</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Headers, paragraphs, code, tables, and lists appear as framed
                    blocks; text fills each block char-by-char.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="text-reveal-structure"
                  value="flat"
                  checked={textRevealStructure === 'flat'}
                  onChange={() => setChatUIDefaults({ textRevealStructure: 'flat' })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex-1">
                  <span className="block text-sm text-slate-200">Flat (characters only)</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Legacy behavior: plain text fades in character by character; markdown renders once after the stream ends.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={textRevealEnabled}
              onChange={(e) => setChatUIDefaults({ textRevealEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium text-slate-200">
                Enable reveal animation
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                When off, new characters appear immediately with no buffering or fade.
              </span>
            </span>
          </label>

          <div className={textRevealEnabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Reveal speed</span>
              <span className="font-mono text-xs text-slate-400">
                {textRevealCharsPerSec} chars/sec
              </span>
            </div>
            <input
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={5}
              value={textRevealCharsPerSec}
              onChange={(e) =>
                setChatUIDefaults({
                  textRevealCharsPerSec: clamp(Number(e.target.value), MIN_RATE, MAX_RATE),
                })
              }
              className="w-full accent-blue-500"
            />
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-600">
              <span>Slow</span>
              <span>Fast</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Higher values catch the animation up to the raw stream faster. The buffer
              still grows when the model streams quicker than this rate.
            </p>
          </div>

          <div className={textRevealEnabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Per-character fade</span>
              <span className="font-mono text-xs text-slate-400">{textRevealFadeMs} ms</span>
            </div>
            <input
              type="range"
              min={MIN_FADE}
              max={MAX_FADE}
              step={20}
              value={textRevealFadeMs}
              onChange={(e) =>
                setChatUIDefaults({
                  textRevealFadeMs: clamp(Number(e.target.value), MIN_FADE, MAX_FADE),
                })
              }
              className="w-full accent-blue-500"
            />
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-600">
              <span>Instant</span>
              <span>Slower fade</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              How long each character takes to fade from 0 to full opacity.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setChatUIDefaults(DEFAULT_CHAT_UI_DEFAULTS)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
          >
            Reset to defaults
          </button>
        </div>
      </section>
    </div>
  );
}
