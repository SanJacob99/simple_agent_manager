/**
 * Shared audio-format helpers. Used on both ends of the TTS pipeline:
 *
 *   - Server: wrap raw PCM returned by a TTS provider in a WAV header so
 *     the chat drawer receives a playable container format.
 *   - Client: detect and wrap raw PCM in old transcript entries that
 *     predate the server-side fix ("retrocompat path"). Without this,
 *     any pre-existing PCM message would forever render as a broken
 *     0:00 player.
 *
 * `Buffer` extends `Uint8Array` in Node, so callers on either end can
 * pass in whatever they have and the typed-array-based impl works.
 */

export interface PcmSpec {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * Does this MIME type describe raw, headerless PCM that browsers cannot
 * decode directly via `<audio>`? We accept a handful of aliases that
 * different TTS providers have used historically.
 */
export function isPcmMimeType(mime: string | undefined | null): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase().split(';')[0].trim();
  return (
    lower === 'audio/l16' ||
    lower === 'audio/pcm' ||
    lower === 'audio/x-pcm' ||
    lower === 'audio/basic' // µ-law, rarely ours but browsers can't decode it either
  );
}

/**
 * Best-effort lookup of PCM parameters from the producing TTS provider
 * id. Used on the client for retrocompat: old transcript entries store
 * the provider but not the raw-PCM sample rate / channel count, so we
 * fall back to the values each provider's `speak()` implementation is
 * known to emit. Mirror any change here in `server/tools/builtins/tts/
 * text-to-speech.ts`'s provider factories.
 */
export function pcmParamsForProvider(provider: string | undefined): PcmSpec {
  switch (provider) {
    case 'elevenlabs':
      return { sampleRate: 16000, channels: 1, bitsPerSample: 16 };
    case 'minimax':
      return { sampleRate: 32000, channels: 1, bitsPerSample: 16 };
    case 'google':
    case 'openai':
    case 'openrouter':
    default:
      return { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  }
}

/**
 * Wrap raw PCM in a 44-byte RIFF/WAVE/fmt/data header so browsers can
 * decode it. Works on both `Uint8Array` and Node `Buffer` inputs; the
 * return type widens to `Uint8Array` which accepts either.
 */
export function wrapPcmAsWav(pcm: Uint8Array, spec: PcmSpec): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = spec;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  writeAscii(out, 0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  writeAscii(out, 8, 'WAVE');
  writeAscii(out, 12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM format code
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeAscii(out, 36, 'data');
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function writeAscii(out: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < s.length; i += 1) {
    out[offset + i] = s.charCodeAt(i);
  }
}
