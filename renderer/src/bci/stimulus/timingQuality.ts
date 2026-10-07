/** Engineering limits, not a physiological guarantee of SSVEP quality. */
export class StimulusTimingQuality {
  private times = new Float64Array(2048);
  private losses = new Float64Array(2048);
  private slots = new Float64Array(2048);
  private head = 0; private count = 0; private lost = 0; private expected = 0;
  private highSince = -1; private lastCheck = -1; private warningChecks = 0;
  reset() { this.head = this.count = this.lost = this.expected = this.warningChecks = 0; this.highSince = this.lastCheck = -1; }
  sample(timestamp: number, interval: number, refreshRateHz: number) {
    const dropped = interval > 1500 / refreshRateHz;
    const loss = dropped ? Math.max(1, Math.round(interval * refreshRateHz / 1000) - 1) : 0;
    while (this.count && (timestamp - this.times[this.head] > 2000 || this.count === this.times.length)) {
      this.lost -= this.losses[this.head]; this.expected -= this.slots[this.head];
      this.head = (this.head + 1) % this.times.length; this.count--;
    }
    const tail = (this.head + this.count) % this.times.length;
    this.times[tail] = timestamp; this.losses[tail] = loss; this.slots[tail] = 1 + loss;
    this.count++; this.lost += loss; this.expected += 1 + loss;
    // Require a populated observation period before using rolling percentages.
    const ready = timestamp - this.times[this.head] >= 1000;
    const rate = this.expected ? this.lost / this.expected : 0;
    if (ready && rate > .15) { if (this.highSince < 0) this.highSince = timestamp; }
    else this.highSince = -1;
    if (this.lastCheck < 0 || timestamp - this.lastCheck >= 500) {
      this.lastCheck = timestamp; this.warningChecks = ready && rate > .05 ? this.warningChecks + 1 : 0;
    }
    let recentLost = 0;
    if (dropped) for (let i = this.count - 1; i >= 0; i--) {
      const index = (this.head + i) % this.times.length;
      if (timestamp - this.times[index] > 500) break;
      recentLost += this.losses[index];
    }
    // One isolated loss of 1–2 frames is recorded, not used to restart analysis.
    // A burst of >=3 lost frames in 0.5 s or a >=100 ms stall invalidates the window.
    const invalidate = dropped && (recentLost >= 3 || interval >= 100);
    return { dropped, invalidate, lostFrames: loss, warning: this.warningChecks >= 2,
      severe: interval >= 250 || (this.highSince >= 0 && timestamp - this.highSince >= 1000) };
  }
}
