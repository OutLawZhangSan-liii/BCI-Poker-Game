/**
 * Online EEG preprocessing shared by calibration and inference.
 *
 * The worker selects P3, P4, Oz and Pz before calling this module.  The
 * current experiment intentionally does not re-reference channels: removing
 * that step preserves each electrode's measured signal for inspection.
 */

function assertRectangular(channels: Float32Array[]): void {
  if (channels.length === 0) throw new Error("preprocessing requires at least one channel");
  const sampleCount = channels[0].length;
  if (channels.some((channel) => channel.length !== sampleCount)) {
    throw new Error("preprocessing requires all channels to have the same sample count");
  }
}

/** Remove the mean (DC/baseline offset) independently from each channel. */
export function detrendChannels(channels: Float32Array[]): Float32Array[] {
  assertRectangular(channels);
  return channels.map((channel) => {
    let mean = 0;
    for (const value of channel) mean += value;
    mean /= Math.max(1, channel.length);
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) output[index] = channel[index] - mean;
    return output;
  });
}

/** Apply the fixed experiment pipeline: baseline removal only. */
export function preprocessChannels(channels: Float32Array[]): Float32Array[] {
  return detrendChannels(channels);
}
