import { bankScale, gateFrameWidth, gateHalfOpening, gateOffset, gateTime, wind, wingHalfSpan, type Flight } from "./flight";

const plane = new Image();
import planeUrl from "./art/plane.png";
plane.src = planeUrl;
export const planeReady = () => plane.decode();
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function drawGate(ctx: CanvasRenderingContext2D, index: number, eta: number, hit: boolean) {
  if (eta < -.93 || eta > 11.9) return;
  const scale = 1 / (1 + .66 * eta);
  const post = gateHalfOpening + gateFrameWidth / 2;
  ctx.save();
  ctx.translate(800 + gateOffset(index) * scale, 439 + 95 * scale);
  ctx.scale(scale, scale);
  ctx.globalAlpha = clamp01((11.9 - eta) / 2.1) * clamp01((eta + .93) / .46)
    * Math.min(.97, .25 + .82 * scale);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-post, 158); ctx.lineTo(-post, -65);
  ctx.bezierCurveTo(-post, -221, post, -221, post, -65);
  ctx.lineTo(post, 158);
  ctx.strokeStyle = hit ? "#ae2f3a" : "#315581"; ctx.lineWidth = gateFrameWidth; ctx.stroke();
  ctx.strokeStyle = hit ? "#ed7774" : "#b3cde6"; ctx.lineWidth = 6; ctx.stroke();

  // The small pennant marks the center of the opening even in the distance.
  const crown = -182;
  ctx.fillStyle = hit ? "#ae2f3a" : "#d5a752";
  ctx.beginPath(); ctx.moveTo(-10, crown); ctx.lineTo(10, crown);
  ctx.lineTo(10, crown + 17); ctx.lineTo(0, crown + 12); ctx.lineTo(-10, crown + 17);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

export function paintFlight(canvas: HTMLCanvasElement, f: Flight, limit: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(canvas.width / 1600, 0, 0, canvas.height / 900, 0, 0);
  ctx.clearRect(0, 0, 1600, 900);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 60, 1600, 735); ctx.clip();
  // Keep the aircraft on the flight centerline; the targets occupy the strip below it.
  ctx.translate(0, -90);
  const gust = wind(f.time, f.difficulty), sign = Math.sign(gust);
  for (let i = 0; i < 5; i++) {
    const u = (f.time * .38 + i * .213) % 1, x = 800 + sign * ((u - .54) * 620), y = 314 + i * 48;
    ctx.globalAlpha = Math.sin(Math.PI * u) * Math.min(.6, Math.abs(gust) / 240);
    ctx.strokeStyle = "#7eacce"; ctx.lineWidth = 1.65;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.bezierCurveTo(x+sign*20,y-8,x+sign*47,y+5,x+sign*86,y-6); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const last = limit ? Math.min(limit - 1, f.attempts + 2) : f.attempts + 2;
  for (let index = last; index >= Math.max(0, f.attempts - 1); index--) drawGate(ctx, index, gateTime(index) - f.time, index === f.lastHitGate);
  const cy = 540 + 2.2 * Math.sin(f.time * 2.4), roll = f.bank * Math.PI / 180;
  ctx.strokeStyle = "#9ebfdb"; ctx.lineWidth = 1.6; ctx.setLineDash([8, 7, 2, 6]);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const p = i / 20, older = (f.tailIndex + f.tail.length - Math.round(p * 103)) % f.tail.length;
      const x = 800 + f.tail[older] + side * (47 + 14 * p), y = cy + 34 + 104 * p + side * 24 * Math.sin(roll) * (1-p);
      if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    }
    ctx.stroke();
  }
  ctx.translate(800 + f.x, cy); ctx.rotate(roll); ctx.scale(bankScale(roll), 1);
  if (plane.complete && plane.naturalWidth) ctx.drawImage(plane,-wingHalfSpan,-60,2*wingHalfSpan,118);
  ctx.restore();
}
