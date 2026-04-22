import { describe, expect, it } from 'vitest';
import {
  isPcmMimeType,
  pcmParamsForProvider,
  wrapPcmAsWav,
} from './audio-format';

describe('isPcmMimeType', () => {
  it('detects the MIME types raw-PCM TTS output ships under', () => {
    expect(isPcmMimeType('audio/L16')).toBe(true);
    expect(isPcmMimeType('audio/l16')).toBe(true);
    expect(isPcmMimeType('audio/l16;rate=24000')).toBe(true);
    expect(isPcmMimeType('audio/pcm')).toBe(true);
    expect(isPcmMimeType('audio/x-pcm')).toBe(true);
  });

  it('returns false for container formats and empties', () => {
    expect(isPcmMimeType('audio/wav')).toBe(false);
    expect(isPcmMimeType('audio/mpeg')).toBe(false);
    expect(isPcmMimeType('audio/ogg')).toBe(false);
    expect(isPcmMimeType('')).toBe(false);
    expect(isPcmMimeType(undefined)).toBe(false);
  });
});

describe('pcmParamsForProvider', () => {
  it('returns the sample rate each provider is known to emit', () => {
    expect(pcmParamsForProvider('elevenlabs').sampleRate).toBe(16000);
    expect(pcmParamsForProvider('minimax').sampleRate).toBe(32000);
    expect(pcmParamsForProvider('openai').sampleRate).toBe(24000);
    expect(pcmParamsForProvider('google').sampleRate).toBe(24000);
    expect(pcmParamsForProvider('openrouter').sampleRate).toBe(24000);
  });

  it('falls back to 24 kHz mono 16-bit for unknown / undefined providers', () => {
    const fallback = pcmParamsForProvider(undefined);
    expect(fallback).toEqual({ sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(pcmParamsForProvider('some_plugin').sampleRate).toBe(24000);
  });
});

describe('wrapPcmAsWav', () => {
  it('prepends a valid 44-byte RIFF/WAVE/fmt/data header', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = wrapPcmAsWav(pcm, { sampleRate: 24000, channels: 1, bitsPerSample: 16 });

    expect(out.length).toBe(44 + pcm.length);
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...out.subarray(offset, offset + len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');

    // Payload bytes survive untouched at the tail.
    expect(Array.from(out.subarray(44))).toEqual(Array.from(pcm));

    // Spot-check the fmt fields via DataView.
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(4, true)).toBe(36 + pcm.length); // chunk size
    expect(dv.getUint16(20, true)).toBe(1); // PCM code
    expect(dv.getUint16(22, true)).toBe(1); // channels
    expect(dv.getUint32(24, true)).toBe(24000); // sample rate
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
    expect(dv.getUint32(40, true)).toBe(pcm.length); // data length
  });

  it('accepts a Node Buffer as input (Buffer extends Uint8Array)', () => {
    const pcm = Buffer.from([0xaa, 0xbb, 0xcc]);
    const out = wrapPcmAsWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    expect(out.length).toBe(47);
    expect(Array.from(out.subarray(44))).toEqual([0xaa, 0xbb, 0xcc]);
  });
});
