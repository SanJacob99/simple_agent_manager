import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const NO_REPLY_PATTERN = /^no_reply$/i;

export class ReplyFilter implements StreamTransform {
  private bufferedEvents: ServerEvent[] = [];
  private pendingMessageStarted = false;

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'message_start') {
      const msg = raw.message as { role?: string };
      if (msg.role === 'assistant') {
        this.pendingMessageStarted = true;
        this.bufferedEvents = [];
        this.bufferedEvents.push({
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
          this.bufferedEvents.push({
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
          this.bufferedEvents = [];
          this.pendingMessageStarted = false;
          emit({
            type: 'message:suppressed',
            agentId: '',
            runId: context.runId,
            reason: 'no_reply',
          } as any);
        } else {
          for (const buffered of this.bufferedEvents) {
            emit(buffered);
          }
          this.bufferedEvents = [];
        }
        return;
      }

      return;
    }

    if (raw.type === 'message_end') {
      if (this.pendingMessageStarted && !context.messageSuppressed) {
        const endMsg = raw.message as { role?: string; usage?: any };
        if (endMsg.role === 'assistant') {
          emit({
            type: 'message:end',
            agentId: '',
            runId: context.runId,
            message: { role: 'assistant', usage: endMsg.usage },
          } as any);
        }
      }
      this.pendingMessageStarted = false;
      return;
    }
  }
}
