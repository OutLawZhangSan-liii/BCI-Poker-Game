export async function measureDisplayRefreshRate(sampleFrames = 120): Promise<number> {
  const intervals: number[] = [];
  await new Promise<void>((resolve, reject) => {
    let previous = 0;
    let frame = 0;
    const cleanup = () => { window.clearTimeout(timeout); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", onVisibility); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const onVisibility = () => { if (document.hidden) fail("窗口已隐藏，显示检查已取消"); };
    const timeout = window.setTimeout(() => fail("显示刷新率测量超时，请保持窗口可见后重试"), 5_000);
    document.addEventListener("visibilitychange", onVisibility);
    const sample = (timestamp: number) => {
      if (previous > 0) intervals.push(timestamp - previous);
      previous = timestamp;
      if (intervals.length >= sampleFrames) { cleanup(); resolve(); } else frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
  });
  const sorted = intervals.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) throw new Error("无法测量显示器刷新率");
  const median = sorted[Math.floor(sorted.length / 2)];
  const measured = 1_000 / median;
  // This measurement is used for timing diagnostics only. Luminance uses
  // elapsed RAF time, so refresh-rate estimation cannot shift its phase.
  return Number(measured.toFixed(2));
}
