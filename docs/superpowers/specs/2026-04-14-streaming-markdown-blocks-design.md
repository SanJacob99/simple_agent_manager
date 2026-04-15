# Streaming Markdown Blocks — Design

## Goal

Render markdown progressively while an assistant message is streaming, so users watch structure form and text flow into it — rather than seeing plain text that later "pops" into formatted markdown at end-of-stream.

The guiding idea: a streaming message is decomposed into **block elements** (headings, paragraphs, code fences, tables, lists, blockquotes, images, horizontal rules). The *frame* of each block (its structural opening — `# `, fence markers, table header + separator, list bullets) is committed and rendered immediately when the scanner can identify the block type. The *content* of each block (the text that fills the frame) is then revealed character-by-character using the existing RAF cursor, scoped to that block. Each block drops in with a short CSS entrance animation when it first appears.

## Non-goals

- Reworking the reasoning / "thinking" panel streaming. It stays on the current pre → markdown swap.
- Changing the server-side delta protocol, the `useChatStream` buffering cadence, or the message store.
- Changing transcript replay from persisted sessions — those render via the completed-state `ReactMarkdown` branch and never touch the scanner.
- Writing a full markdown parser. We keep ReactMarkdown + remarkGfm and scope its work to one block at a time.

## Architecture

Three new pieces under `src/chat/`:

### `streaming-markdown-scanner.ts`

Pure, non-React line-level state machine. One instance per streaming message.

```ts
type BlockType =
  | 'paragraph'
  | 'heading'
  | 'code_fence'
  | 'blockquote'
  | 'list'
  | 'list_item'
  | 'table'
  | 'table_row'
  | 'hr'
  | 'image'
  | 'setext_heading';

type BlockStatus = 'tentative' | 'open' | 'closed';

interface Block {
  id: string;
  type: BlockType;
  status: BlockStatus;
  frameSource: string;    // structural chars rendered immediately
  contentSource: string;  // growing body chars gated by the reveal cursor
  children?: Block[];     // list items inside a list; table body rows inside a table
}

interface Scanner {
  append(chars: string): void;
  getBlocks(): readonly Block[];
  onChange(cb: () => void): () => void;
  finalize(): void;  // force-commit any tentative blocks
}
```

The scanner operates on completed lines. It buffers raw chars until it sees `\n`, then classifies that line and either opens a new block, appends to the current block, or closes it. No markdown parsing happens here — it only answers "which block does the next char belong to, and is that block done?"

### `StreamingMarkdownRenderer.tsx`

React component owned by `MessageBubble` during an assistant stream. Holds the scanner instance, diffs `msg.content` against the scanner's already-consumed offset to append new chars, mirrors the scanner's block list into React state, and renders each block via `StreamingBlock` keyed by `block.id`. Replaces the current `<StreamingText>` branch for assistant messages.

### `StreamingBlock.tsx`

Renders exactly one block. Manages its own RAF cursor `displayCount` advancing at the configured `textRevealCharsPerSec`, using the same linear-rate logic already proven in `src/chat/StreamingText.tsx`. Each frame it computes

```ts
const slice = block.frameSource
  + autoClose(block.contentSource.slice(0, displayCount), block.type);
```

and passes `slice` through `<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>`. The outer wrapper element has a one-shot `stream-block-in` CSS class applied on mount for the ~200 ms fade-in + translate-Y entrance.

For `list` and `table` parents with children, `StreamingBlock` renders the frame and recursively renders each child block so list items / table body rows each drop in with their own entrance animation and their own char cursor.

## Data flow

```
server delta
  → useChatStream buffered flush (existing 32ms setTimeout in useChatStream.ts:133-138)
    → msg.content updated in session store
      → StreamingMarkdownRenderer observes content growth
        → scanner.append(newChars)
          → scanner.getBlocks() returns updated ordered list
            → React renders each StreamingBlock
              → per-block RAF cursor advances displayCount
                → ReactMarkdown(frameSource + autoClose(contentSource.slice(0, displayCount)))
```

`useChatStream.ts` is not modified. The scanner is driven entirely off content updates.

## Scanner behavior

### Direct detection (committed when the line completes)

| Pattern at line start | Block type |
|---|---|
| `#` to `######` + space | `heading` |
| ```` ``` ```` or `~~~` | `code_fence` — toggles open/close |
| `> ` | `blockquote` |
| `- `, `* `, `+ `, `N. ` | `list_item` (inside the currently open `list`, or opens a new one) |
| `---`, `***`, `___` alone on a line | `hr` |
| `![alt](url)` alone on a line | `image` |
| anything else, non-blank | `paragraph` (may be tentative — see below) |
| blank line | closes the currently open paragraph, list, or blockquote |

Inside an open `code_fence`, detection is suspended — every line is appended verbatim to the fence's `contentSource` until the matching closing fence is seen.

### Disambiguation hold

Two patterns require one line of lookahead and cannot commit immediately:

- **Table.** A line starting with `|` is held as a tentative block. If the next completed line matches `| ---+ | ---+ |`, the tentative line is promoted to a `table` block as its header row, and the separator line becomes part of the frame. Otherwise it commits as a `paragraph`.
- **Setext heading.** A paragraph line followed by a line of `===` or `---` is retroactively promoted from `paragraph` to `setext_heading`. Otherwise the `---` line commits as an `hr`.

Tentative blocks exist in the block list with `status: 'tentative'`, but `StreamingMarkdownRenderer` does not render them — the user sees nothing for that line until it resolves. The hold is bounded by:

1. The next line arriving (normal case, resolves within the next delta).
2. A **150 ms idle timer** since the last char (handles stream pauses mid-hold — commits to the fallback type).
3. `scanner.finalize()` being called on `message:end` — force-commits to the fallback.

### Frame vs content split per block type

| Block type | `frameSource` | `contentSource` |
|---|---|---|
| `paragraph` | `""` | full line(s) |
| `heading` | `"# "` (or `##`, etc.) | the heading text |
| `code_fence` | `"```lang\n"` | lines inside the fence |
| `blockquote` | `"> "` | the quoted text |
| `list` | `""` (renders a bare `<ul>`/`<ol>`) | empty, children hold items |
| `list_item` | `"- "` (or `"1. "`) | item text |
| `table` | header row + separator row | empty, children hold body rows |
| `table_row` (internal) | `"| "` scaffolding | row cells |
| `hr` | `"---\n"` | empty |
| `image` | full `![alt](url)` | empty |
| `setext_heading` | text line + underline | empty (content was the promoted paragraph line, moved into the frame on promotion) |

This split is what produces the "frame appears first, content fills it" effect: a heading block opens with `displayCount = 0` and already renders an empty `<h1>`, which then populates char-by-char as the cursor advances.

## `autoClose` helper

```ts
function autoClose(text: string, blockType: BlockType): string;
```

Pure. Walks `text` tracking open inline tokens in a stack: `**`, `*`, `_`, `__`, `` ` ``, `~~`, `[`. On return, appends closing tokens in LIFO order so ReactMarkdown sees well-formed input. For `code_fence` blocks, also appends a trailing ```` ``` ```` if the fence isn't already closed within the slice.

This is what eliminates mid-stream flickering between literal `**bo` and rendered **bold** as tokens are being typed.

## Rendering

### Entrance animation

A single CSS keyframe added to `src/app.css` alongside the existing `stream-char-fade`:

```css
@keyframes stream-block-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

.stream-block-in {
  animation: stream-block-in 200ms ease-out both;
}
```

Applied to each `StreamingBlock`'s outer wrapper on mount, fires once.

### Per-block cursor

`StreamingBlock` uses the same RAF loop pattern as `src/chat/StreamingText.tsx` (INITIAL_BUFFER_CHARS / INITIAL_BUFFER_MS startup grace, strictly linear advance at `textRevealCharsPerSec` drawn from settings, no bursting). The cursor counts characters of `contentSource` only — frame characters are always rendered, so the perceived reveal speed corresponds to visible text regardless of how long the structural markers are.

### Memoization

`StreamingBlock` is wrapped in `React.memo` keyed on `{ blockId, contentSource.length, status }`. Adding a 30th block does not re-render the first 29 — each block only re-renders when its own content grows or status flips.

## Integration point

Single edit in `src/chat/MessageBubble.tsx` around line 163-168: the `useStreamingRenderer` branch switches from

```tsx
<StreamingText text={msg.content} isStreaming={isStreamingThis} onRevealComplete={handleRevealComplete} />
```

to

```tsx
<StreamingMarkdownRenderer
  text={msg.content}
  isStreaming={isStreamingThis}
  onRevealComplete={handleRevealComplete}
/>
```

The surrounding `revealComplete` handshake, final-swap to full-document `ReactMarkdown` on completion, plain-text fallback for non-assistant messages, and cursor blinker for empty-content state are all unchanged. `useChatStream` is untouched.

## Settings

Existing fields in `src/settings/types.ts` keep their meaning:

- `textRevealEnabled` — when `false`, the new renderer still uses the scanner (frame-first reveal is preserved) but fast-forwards each block's cursor to full length immediately on commit. Block entrance animation still runs.
- `textRevealCharsPerSec` — governs the per-block char cursor rate, same as today.
- `textRevealFadeMs` — unused in the new renderer (per-char fade is replaced by per-block fade). Retained for back-compat with the `'flat'` mode below.

One new field:

```ts
textRevealStructure: 'blocks' | 'flat';  // default 'blocks'
```

`'flat'` falls back to today's `StreamingText` rendering for users who prefer the old look. `'blocks'` activates the new renderer.

Corresponding UI in `src/settings/sections/AppearanceSection.tsx` gets one new select control.

## Edge cases

- **Message suppressed mid-stream** (`message:suppressed` event) — `StreamingMarkdownRenderer` unmounts with the message via the existing `deleteMessage` path in `useChatStream.ts`. Scanner is discarded. No cleanup needed.
- **Stream error mid-block** — `agent:error` / `lifecycle:error` handler already replaces the in-progress message with an error bubble. The renderer unmounts the same way.
- **Stream ends mid-code-fence or mid-table body** — `scanner.finalize()` commits any tentative block to its fallback type. Blocks whose fences or tables are still open rely on `autoClose` to produce well-formed input until the `revealComplete` swap replaces the whole view with a single-pass `ReactMarkdown` of the final `msg.content`.
- **Empty message** — scanner has no blocks, renderer returns `null`, existing cursor blinker in `MessageBubble.tsx:176-178` still shows.
- **User scrolled up during stream** — unaffected. Each new block is a content update inside the existing message DOM node, not a new message, so `ChatMessages.tsx:87-105` pin-to-bottom logic continues to work correctly.
- **Very fast deltas** — backlog accumulates in each block's `contentSource`, cursor still advances at the configured rate. Matches today's "no bursting" guarantee from `StreamingText.tsx:72-74`.
- **Very slow deltas (idle pause inside a tentative table)** — 150 ms idle commits to paragraph fallback. If the table separator arrives *after* the idle commit, it's too late — the row already committed as paragraph. This is acceptable: 150 ms is long enough that a coherent model output will arrive inside the window.
- **Multiple streaming messages at once** — each `StreamingMarkdownRenderer` owns its own scanner. No shared state.

## Testing

### Scanner unit tests (`src/chat/streaming-markdown-scanner.test.ts`)

- Every block type: feed a minimal example, assert the produced block list.
- Table disambiguation: both promotion path (separator arrives) and fallback path (separator doesn't arrive).
- Setext heading disambiguation: both promotion and fallback.
- Idle timeout commit for tentative paragraph + `|`-starting line.
- Code fence suspension: `# foo` inside a fence stays a code line.
- Nested list items and list closing on blank line.
- Property test: take a corpus of finished messages, chunk each into randomized delta sizes (1, 5, 50 chars), feed through the scanner, and assert the final block list is identical regardless of chunking.

### React integration tests

- Feed a known streaming transcript through `StreamingMarkdownRenderer` driven by a mock delta stream, advance RAF, snapshot rendered DOM at key frames (first block open, first block content partially filled, second block opened, end-of-stream swap).
- Verify the existing `revealComplete` swap still fires and the post-stream DOM matches the full-document `ReactMarkdown` render.

### Manual verification checklist

- Stream a long paragraph: block frame is immediate, char cursor fills at configured rate.
- Stream a code fence: card + language label appear instantly, code lines fill as they arrive.
- Stream a table: no flicker, frame appears only after separator row, body rows drop in one at a time.
- Stream a setext heading: paragraph doesn't render until the `===` line either arrives or the idle timer commits.
- Toggle `textRevealEnabled` off: blocks still drop in with entrance animation, but text appears instantly inside each block.
- Toggle `textRevealStructure` to `'flat'`: old `StreamingText` behavior restored.
- Scroll up during stream: new blocks don't yank scroll position.

## Open questions

None at design time. Implementation-time decisions (exact memoization key shape, component file layout under `src/chat/`, precise settings UI labels) will be made in the implementation plan.
