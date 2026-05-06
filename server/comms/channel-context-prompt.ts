/**
 * Build the per-run channel-context system prompt block injected into a
 * receiver agent's system prompt for the duration of a channel-mode run.
 *
 * The base block tells the model it is in a peer channel-session and how
 * to reply (`agent_send` / `end:true`).
 *
 * When `isFinalTurn` is true, the channel is sealed (e.g., the previous
 * `agent_send` hit the pair `maxTurns` cap), so further `agent_send`
 * calls will be rejected with `channel_sealed`. In that case we append a
 * notice instructing the model to reply with normal assistant text only;
 * that text is persisted to the channel transcript and the peer can read
 * it via `agent_channel_history`.
 */
export function buildChannelContextBlock(peerName: string, isFinalTurn: boolean): string {
  const base =
    `You are in a peer channel-session with agent ${peerName}. ` +
    `Use agent_send to reply. Use end:true when you are intentionally ending the exchange.`;
  if (!isFinalTurn) return base;
  return (
    base +
    '\n\nNOTE: this channel is sealed. Any agent_send call will be rejected with ' +
    'channel_sealed. Reply with normal assistant text only — it is persisted to the ' +
    'channel transcript and the peer can read it via agent_channel_history. Do not call agent_send.'
  );
}
