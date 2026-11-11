import { describe, expect, it } from 'vitest';
import { interleavePreview } from './nativeAudio';

function fakeBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('native sample preview', () => {
  it('interleaves stereo frames for the PCM command', () => {
    const buffer = fakeBuffer([
      new Float32Array([1, 2, 3]),
      new Float32Array([10, 20, 30]),
    ]);
    const preview = interleavePreview(buffer);

    expect(preview.channels).toBe(2);
    expect(preview.frames).toBe(3);
    expect(Array.from(preview.pcm)).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('trims long samples to the preview limit', () => {
    const buffer = fakeBuffer([new Float32Array(96_000)], 48_000);
    const preview = interleavePreview(buffer, 1);

    expect(preview.frames).toBe(48_000);
    expect(preview.pcm).toHaveLength(48_000);
  });
});
