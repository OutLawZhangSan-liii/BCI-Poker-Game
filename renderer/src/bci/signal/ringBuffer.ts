export class SignalRingBuffer {
  private data: Float32Array;
  private writeSample = 0;
  private available = 0;
  totalSamplesWritten = 0;

  constructor(readonly channelCount: number, readonly capacitySamples: number) {
    if (channelCount <= 0 || capacitySamples <= 0) throw new Error("invalid ring buffer dimensions");
    this.data = new Float32Array(channelCount * capacitySamples);
  }

  get availableSamples(): number { return this.available; }

  clear(): void {
    this.writeSample = 0; this.available = 0; this.totalSamplesWritten = 0; this.data.fill(0);
  }

  pushTimeMajor(samples: Float32Array, sampleCount: number): void {
    if (samples.length !== sampleCount * this.channelCount) throw new Error("ring buffer input dimensions do not match");
    for (let sample = 0; sample < sampleCount; sample += 1) {
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        this.data[channel * this.capacitySamples + this.writeSample] = samples[sample * this.channelCount + channel];
      }
      this.writeSample = (this.writeSample + 1) % this.capacitySamples;
      this.available = Math.min(this.capacitySamples, this.available + 1);
      this.totalSamplesWritten += 1;
    }
  }

  /** Preserve the acquisition clock across missing samples without inventing EEG. */
  skipSamples(sampleCount: number): void {
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) throw new Error("invalid missing sample count");
    if (sampleCount >= this.capacitySamples) {
      this.data.fill(NaN);
      this.writeSample = (this.writeSample + sampleCount % this.capacitySamples) % this.capacitySamples;
      this.available = this.capacitySamples;
      this.totalSamplesWritten += sampleCount;
      return;
    }
    const missing = new Float32Array(sampleCount * this.channelCount); missing.fill(NaN);
    this.pushTimeMajor(missing, sampleCount);
  }

  latest(sampleCount: number, channelIndices: number[]): Float32Array[] {
    return this.windowEnding(this.totalSamplesWritten, sampleCount, channelIndices);
  }

  /** Read an exact trial-relative window [endSample-sampleCount, endSample). */
  windowEnding(endSample: number, sampleCount: number, channelIndices: number[]): Float32Array[] {
    if (!Number.isInteger(endSample) || !Number.isInteger(sampleCount) || sampleCount < 0) throw new Error("invalid ring buffer window");
    if (endSample > this.totalSamplesWritten) throw new Error("ring buffer window ends in the future");
    const oldestAvailable = this.totalSamplesWritten - this.available;
    if (endSample - sampleCount < oldestAvailable) throw new Error("ring buffer window is no longer available");
    const distanceFromWrite = this.totalSamplesWritten - (endSample - sampleCount);
    const start = (this.writeSample - distanceFromWrite % this.capacitySamples + this.capacitySamples) % this.capacitySamples;
    return channelIndices.map((channel) => {
      if (channel < 0 || channel >= this.channelCount) throw new Error("channel index out of range");
      const output = new Float32Array(sampleCount);
      for (let sample = 0; sample < sampleCount; sample += 1) {
        output[sample] = this.data[channel * this.capacitySamples + (start + sample) % this.capacitySamples];
      }
      return output;
    });
  }
}
