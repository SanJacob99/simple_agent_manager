import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const NO_REPLY_PATTERN = /^no_reply$/i;

function extractAssistantText(message: { content?: unknown }): string {
  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block): block is { type: string; text?: string } => !!block && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
}

export class ReplyFilter implements StreamTransform {
  private pendingMessageStarted = false;
  private isBuffering = false;
  private pendingEvents: ServerEvent[] = [];
  private hadThinking = false;

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'message_start') {
      const msg = raw.message as { role?: string };
      if (msg.role === 'assistant') {
        this.pendingMessageStarted = true;
        this.hadThinking = false;
        this.isBuffering = true;
        this.pendingEvents = [];
        // Buffer message:start — only emit if we confirm it's not NO_REPLY
        this.pendingEvents.push({
          type: 'message:start',
          agentId: '',
          runId: context.runId,
          message: { role: 'assistant' },
        } as any);
      }
      return;
    }

    if (raw.type === 'message_update') {
      const aEvent = raw.assistantMessageEvent;
      if (!aEvent) return;

      // Track whether any thinking blocks arrived for this assistant turn.
      if (aEvent.type === 'thinking_start') {
        this.hadThinking = true;
      }

      if (aEvent.type === 'text_delta') {
        context.textBuffer += aEvent.delta;
        if (this.pendingMessageStarted) {
          if (this.isBuffering) {
            // Buffer delta — only emit if we confirm it's not NO_REPLY
            this.pendingEvents.push({
              type: 'message:delta',
              agentId: '',
              runId: context.runId,
              delta: aEvent.delta,
            } as any);
            
            const normalized = context.textBuffer.trimStart().toLowerCase();
            const possibleNoReply = 
              normalized === '' || 
              "no_reply".startsWith(normalized) || 
              (normalized.startsWith("no_reply") && normalized.trim() === "no_reply");
              
            if (!possibleNoReply) {
              this.isBuffering = false;
              this.pendingEvents.forEach(emit);
              this.pendingEvents = [];
            }
          } else {
            // Not buffering, emit directly
            emit({
              type: 'message:delta',
              agentId: '',
              runId: context.runId,
              delta: aEvent.delta,
            } as any);
          }
        }
        return;
      }

      if (aEvent.type === 'text_end') {
        const content = (aEvent.content as string) ?? '';
        if (NO_REPLY_PATTERN.test(content.trim())) {
          context.noReplyDetected = true;
          context.messageSuppressed = true;
          this.pendingMessageStarted = false;
          this.isBuffering = false;
          this.pendingEvents = [];
          emit({
            type: 'message:suppressed',
            agentId: '',
            runId: context.runId,
            reason: 'no_reply',
          } as any);
        } else {
          // Not NO_REPLY, flush pending events if still buffering
          this.isBuffering = false;
          this.pendingEvents.forEach(emit);
          this.pendingEvents = [];
        }
        return;
      }

      return;
    }

    if (raw.type === 'message_end') {
      if (this.pendingMessageStarted && !context.messageSuppressed) {
        const endMsg = raw.message as { role?: string; usage?: any; content?: unknown };
        if (endMsg.role === 'assistant') {
          // Fallback: if no deltas streamed, send full text in one delta
          const fallbackText =
            context.textBuffer.length === 0 ? extractAssistantText(endMsg) : '';

          if (fallbackText) {
            context.textBuffer = fallbackText;
            if (NO_REPLY_PATTERN.test(fallbackText.trim())) {
              context.noReplyDetected = true;
              context.messageSuppressed = true;
              this.pendingMessageStarted = false;
              this.isBuffering = false;
              this.pendingEvents = [];
              emit({
                type: 'message:suppressed',
                agentId: '',
                runId: context.runId,
                reason: 'no_reply',
              } as any);
              return;
            }
            // Not NO_REPLY, flush pending events and add the fallback delta
            this.isBuffering = false;
            this.pendingEvents.forEach(emit);
            emit({
              type: 'message:delta',
              agentId: '',
              runId: context.runId,
              delta: fallbackText,
            } as any);
          } else {
            // No text content at all. If the model only produced thinking
            // blocks (and no text was accumulated via text_end), suppress the
            // empty bubble entirely — the reasoning:end event already closed
            // the "Thinking..." indicator on the client.
            if (this.hadThinking && context.textBuffer.length === 0) {
              this.pendingMessageStarted = false;
              this.isBuffering = false;
              this.pendingEvents = [];
              return;
            }
            // No thinking either — or thinking happened but text was already
            // streamed (text_end flushed pendingEvents). Flush any remaining
            // pending events so at least an empty bubble appears.
            this.isBuffering = false;
            this.pendingEvents.forEach(emit);
          }

          emit({
            type: 'message:end',
            agentId: '',
            runId: context.runId,
            message: { role: 'assistant', usage: endMsg.usage },
          } as any);
        }
      }
      this.pendingMessageStarted = false;
      this.isBuffering = false;
      this.pendingEvents = [];
      this.hadThinking = false;
      return;
    }
  }
}
