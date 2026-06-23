import { describe, expect, it } from 'vitest';
import type { ResolvedTelemetryConfig } from '../../shared/agent-config';
import {
  RunRecorder,
  createRunRecorder,
  summarizeSpan,
  type PriceTable,
} from './telemetry-engine';

function makeConfig(
  overrides: Partial<ResolvedTelemetryConfig> = {},
): ResolvedTelemetryConfig {
  return {
    telemetryNodeId: 't1',
    label: 'Test Telemetry',
    enabled: true,
    captureTokens: true,
    captureCost: true,
    captureLatency: true,
    captureToolCalls: true,
    exporter: 'none',
    otlpEndpoint: '',
    otlpHeaders: {},
    filePath: '',
    serviceName: 'test',
    sampleRate: 1,
    redactContent: false,
    ...overrides,
  };
}

const PRICES: PriceTable = {
  'anthropic/claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
};

describe('RunRecorder', () => {
  it('is inactive when telemetry is disabled', () => {
    const rec = createRunRecorder(makeConfig({ enabled: false }), 'run');
    expect(rec.active).toBe(false);
    expect(rec.finish()).toBeNull();
  });

  it('honors the sample rate deterministically', () => {
    const config = makeConfig({ sampleRate: 0.5 });
    const recorded = new RunRecorder(config, 'run', {}, () => 0.4);
    const dropped = new RunRecorder(config, 'run', {}, () => 0.6);
    expect(recorded.active).toBe(true);
    expect(dropped.active).toBe(false);
  });

  it('records token, cost, and tool spans into the run tree', () => {
    const rec = createRunRecorder(makeConfig(), 'run', PRICES);
    const model = 'anthropic/claude-sonnet-4-6';
    rec.startTurn(model);
    rec.recordToolCall('calculator', 12, { input: '2+2', output: '4' });
    rec.endTurn(model, { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    const span = rec.finish('ok');
    expect(span).not.toBeNull();

    const summary = summarizeSpan(span!);
    expect(summary.inputTokens).toBe(1_000_000);
    expect(summary.outputTokens).toBe(1_000_000);
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(summary.costUsd).toBeCloseTo(18, 5);
    expect(summary.toolCalls).toBe(1);
  });

  it('omits tool content when redactContent is set', () => {
    const rec = createRunRecorder(makeConfig({ redactContent: true }), 'run');
    rec.startTurn('m');
    rec.recordToolCall('exec', 5, { input: 'rm -rf /', output: 'secret' });
    const span = rec.finish();
    const toolSpan = span!.children[0].children[0];
    expect(toolSpan.attributes['tool.input']).toBeUndefined();
    expect(toolSpan.attributes['tool.output']).toBeUndefined();
    expect(toolSpan.attributes['tool.name']).toBe('exec');
  });

  it('skips tool spans when captureToolCalls is off', () => {
    const rec = createRunRecorder(makeConfig({ captureToolCalls: false }), 'run');
    rec.startTurn('m');
    rec.recordToolCall('exec', 5);
    const span = rec.finish();
    expect(span!.children[0].children).toHaveLength(0);
  });
});
