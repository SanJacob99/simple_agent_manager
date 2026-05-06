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
    expect(useSamAgentStore.getState().streaming).toEqual({ messageId: 'm1', text: '' });
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
});
