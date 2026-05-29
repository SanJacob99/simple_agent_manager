import { describe, it, expect, beforeEach } from 'vitest';
import { useSamAgentStore } from './sam-agent-store';

describe('sam-agent-store', () => {
  beforeEach(() => {
    useSamAgentStore.setState({
      messages: [], streaming: null, hitlPending: null, transcriptLoaded: false,
    } as any);
  });

  it('handleEvent message:start initialises the streaming message', () => {
    useSamAgentStore.getState().handleEvent({ type: 'message:start', messageId: 'm1' });
    expect(useSamAgentStore.getState().streaming).toEqual({
      messageId: 'm1',
      text: '',
      thinking: '',
      isThinking: false,
    });
  });

  it('handleEvent message:start with the same messageId preserves accumulated text', () => {
    // Simulates a turn with a tool call: text → tool → text. The server keeps
    // the same currentMessageId across both runtime message_start cycles, so
    // the client must NOT wipe its accumulator on the second one.
    const store = useSamAgentStore.getState();
    store.handleEvent({ type: 'message:start', messageId: 'm1' });
    store.handleEvent({ type: 'message:delta', messageId: 'm1', textDelta: 'before tool' });
    store.handleEvent({ type: 'message:start', messageId: 'm1' });
    expect(useSamAgentStore.getState().streaming?.text).toBe('before tool');
  });

  it('handleEvent thinking:delta accumulates thinking and survives lifecycle:end', () => {
    const store = useSamAgentStore.getState();
    store.handleEvent({ type: 'message:start', messageId: 'm1' });
    store.handleEvent({ type: 'thinking:start', messageId: 'm1' });
    store.handleEvent({ type: 'thinking:delta', messageId: 'm1', textDelta: 'reasoning ' });
    store.handleEvent({ type: 'thinking:delta', messageId: 'm1', textDelta: 'step' });
    store.handleEvent({ type: 'thinking:end', messageId: 'm1' });
    store.handleEvent({ type: 'message:delta', messageId: 'm1', textDelta: 'answer' });
    store.handleEvent({ type: 'lifecycle:end' });
    const msg = useSamAgentStore.getState().messages.find((m) => m.id === 'm1');
    expect(msg?.thinking).toBe('reasoning step');
    expect(msg?.text).toBe('answer');
  });

  it('handleEvent message:delta accumulates text', () => {
    useSamAgentStore.getState().handleEvent({ type: 'message:start', messageId: 'm1' });
    useSamAgentStore.getState().handleEvent({ type: 'message:delta', messageId: 'm1', textDelta: 'he' });
    useSamAgentStore.getState().handleEvent({ type: 'message:delta', messageId: 'm1', textDelta: 'llo' });
    expect(useSamAgentStore.getState().streaming?.text).toBe('hello');
  });

  it('handleEvent lifecycle:end commits streaming into messages', () => {
    useSamAgentStore.getState().handleEvent({ type: 'message:start', messageId: 'm1' });
    useSamAgentStore.getState().handleEvent({ type: 'message:delta', messageId: 'm1', textDelta: 'hi' });
    useSamAgentStore.getState().handleEvent({ type: 'lifecycle:end' });
    expect(useSamAgentStore.getState().streaming).toBeNull();
    expect(useSamAgentStore.getState().messages.find((m) => m.id === 'm1')?.text).toBe('hi');
  });

  it('handleEvent hitl:input_required sets hitlPending', () => {
    useSamAgentStore.getState().handleEvent({
      type: 'hitl:input_required', toolCallId: 'tc', kind: 'text', question: 'why?', timeoutMs: 60_000,
    });
    expect(useSamAgentStore.getState().hitlPending?.toolCallId).toBe('tc');
  });

  it('handleEvent hitl:resolved clears hitlPending', () => {
    useSamAgentStore.setState({ hitlPending: { toolCallId: 'tc', kind: 'text', question: 'q', timeoutMs: 60_000 } } as any);
    useSamAgentStore.getState().handleEvent({ type: 'hitl:resolved', toolCallId: 'tc', answer: { kind: 'text', answer: 'a' } });
    expect(useSamAgentStore.getState().hitlPending).toBeNull();
  });

  it('setPatchState updates patchState on the right tool result', () => {
    useSamAgentStore.setState({
      messages: [{
        id: 'm1', role: 'assistant', text: '',
        toolResults: [{ toolName: 'propose_workflow_patch', toolCallId: 'tc1', resultJson: '{}', patchState: 'pending' }],
      }],
    } as any);
    useSamAgentStore.getState().setPatchState('m1', 'tc1', 'applied');
    const tr = useSamAgentStore.getState().messages[0].toolResults![0];
    expect(tr.patchState).toBe('applied');
  });

  it('setPatchState also updates streaming.toolResults so a live Apply flips off pending', () => {
    // Regression: if the patch is rendered from streaming (turn still in
    // flight) and setPatchState only touched messages, the Apply card never
    // exits 'pending' on screen and a second click re-applies the patch —
    // user-visible bug: "I asked for one agent and it added two."
    useSamAgentStore.setState({
      messages: [],
      streaming: {
        messageId: 'm-live',
        text: '',
        thinking: '',
        isThinking: false,
        toolResults: [
          { toolName: 'propose_workflow_patch', toolCallId: 'tc-live', resultJson: '{}', patchState: 'pending' },
        ],
      },
    } as any);
    useSamAgentStore.getState().setPatchState('m-live', 'tc-live', 'applied');
    expect(useSamAgentStore.getState().streaming?.toolResults?.[0].patchState).toBe('applied');
  });
});
