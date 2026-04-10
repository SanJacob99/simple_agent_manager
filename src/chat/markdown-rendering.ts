import type { Message } from '../store/session-store';

export const EAGER_MARKDOWN_ASSISTANT_COUNT = 6;
export const MARKDOWN_BATCH_SIZE = 4;

export function getAssistantMessageIds(messages: Message[]): string[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.id);
}

export function getInitialRichMarkdownMessageIds(
  messages: Message[],
  eagerCount = EAGER_MARKDOWN_ASSISTANT_COUNT,
): string[] {
  const assistantIds = getAssistantMessageIds(messages);
  return assistantIds.slice(-eagerCount);
}
