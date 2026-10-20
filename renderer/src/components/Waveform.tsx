import { useEffect, useRef } from "react";

export function Waveform({ samples }: { samples: Float32Array | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !samples?.length) return;
    const scale = window.devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale);
    const context = canvas.getContext("2d"); if (!context) return;
    context.scale(scale, scale); context.clearRect(0, 0, width, height); context.strokeStyle = "#416784"; context.lineWidth = 1.5;
    let minimum = Infinity, maximum = -Infinity;
    for (const value of samples) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    const range = maximum - minimum || 1; context.beginPath();
    samples.forEach((value, index) => {
      const x = index / Math.max(1, samples.length - 1) * width, y = height - (value - minimum) / range * height;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }, [samples]);
  return <canvas ref={canvasRef} className="waveform" aria-label="第一通道调试波形" />;
}
