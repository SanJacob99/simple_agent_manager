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
  private pendingEvents: ServerEvent[] = [];

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'message_start') {
      const msg = raw.message as { role?: string };
      if (msg.role === 'assistant') {
        this.pendingMessageStarted = true;
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

      if (aEvent.type === 'text_delta') {
        context.textBuffer += aEvent.delta;
        if (this.pendingMessageStarted) {
          // Buffer delta — only emit if we confirm it's not NO_REPLY
          this.pendingEvents.push({
            type: 'message:delta',
            agentId: '',
            runId: context.runId,
            delta: aEvent.delta,
          } as any);
        }
        return;
      }

      if (aEvent.type === 'text_end') {
        const content = (aEvent.content as string) ?? '';
        if (NO_REPLY_PATTERN.test(content.trim())) {
          context.noReplyDetected = true;
          context.messageSuppressed = true;
          this.pendingMessageStarted = false;
          this.pendingEvents = [];
          emit({
            type: 'message:suppressed',
            agentId: '',
            runId: context.runId,
            reason: 'no_reply',
          } as any);
        } else {
          // Not NO_REPLY, flush pending events
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
            this.pendingEvents.forEach(emit);
            emit({
              type: 'message:delta',
              agentId: '',
              runId: context.runId,
              delta: fallbackText,
            } as any);
          } else {
            // No fallback text, just flush pending
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
      this.pendingEvents = [];
      return;
    }
  }
}
