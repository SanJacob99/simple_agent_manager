import { describe, expect, it } from 'vitest';
import { buildChannelContextBlock } from './channel-context-prompt';

describe('buildChannelContextBlock', () => {
  it('returns the base block when not the final turn', () => {
    const block = buildChannelContextBlock('beta', false);
    expect(block).toContain('peer channel-session with agent beta');
    expect(block).toContain('Use agent_send to reply');
    expect(block).toContain('end:true');
    expect(block).not.toContain('channel is sealed');
    expect(block).not.toContain('channel_sealed');
  });

  it('appends the sealed notice when isFinalTurn is true', () => {
    const block = buildChannelContextBlock('alpha', true);
    // Still contains the base block
    expect(block).toContain('peer channel-session with agent alpha');
    expect(block).toContain('Use agent_send to reply');
    // Plus the sealed notice
    expect(block).toContain('this channel is sealed');
    expect(block).toContain('channel_sealed');
    expect(block).toContain('agent_channel_history');
    expect(block).toContain('Do not call agent_send');
  });
});
