import { useEffect, useRef } from "react";
import { SIMPLE_STIMULUS_GEOMETRY, type StimulusFrameStats, type StimulusTarget } from "../bci/stimulus/types";
import { computeResponsiveStimulusGeometry, GAME_DECK_TOP_RATIO, hasSignificantStimulusResize, type ResponsiveStimulusGeometrySnapshot } from "../bci/stimulus/geometry";
import { modulationLevel, cardFaceBrightness } from "../bci/stimulus/modulation";
import { StimulusTimingQuality } from "../bci/stimulus/timingQuality";
import { stimulusRenderScale } from "../bci/stimulus/renderBudget";
import { stimulusLuminanceAt } from "../bci/stimulus/phase";
import type { FixationMode } from "../bci/stimulus/comparison";

interface Props {
  active: boolean;
  stimulusStartTimestamp?: number;
  stimulusEndTimestamp?: number;
  debugTiming?: boolean;
  selectedTargetIndex?: number | null;
  dealing?: boolean;
  targets: StimulusTarget[];
  activeTargetIndex?: number | null;
  refreshRateHz?: number;
  luminanceBaseline?: number;
  modulationAmplitude?: number;
  modulationDepth?: number;
  onFirstFrame?: (performanceMs: number) => void;
  onFrameStats?: (stats: StimulusFrameStats) => void;
  onTimingStats?: (stats: StimulusFrameStats) => void;
  onDealComplete?: () => void;
  referenceLabel?: string;
  referenceTag?: string;
  referenceX?: number;
  referenceY?: number;
  showReference?: boolean;
  compactCards?: boolean;
  showFrequencyLabels?: boolean;
  surface?: "standard" | "game";
  targetAppearance?: "card" | "card-face" | "solid";
  stimulusFootprint?: "seat" | "card";
  targetSize?: "standard" | "diagnostic-large" | "teaching-fill";
  showSolidFixationPoint?: boolean;
  fixationMode?: FixationMode;
  onTargetClick?: (targetIndex: number) => void;
  onGeometryChange?: (snapshot: ResponsiveStimulusGeometrySnapshot) => void;
  onResizeWhileActive?: () => void;
  onTimingFault?: () => void;
  onTimingDisruption?: (warning: boolean, invalidate: boolean) => void;
}

const roundedRect = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  context.beginPath(); context.roundRect(x, y, width, height, radius);
};

export function StimulusTable({ active, dealing = false, targets, refreshRateHz = 60, luminanceBaseline = 0.5,
  modulationAmplitude = 0.45, modulationDepth = 1, activeTargetIndex = null, onFirstFrame, onFrameStats, onTimingStats, onDealComplete, referenceLabel = "9♠", referenceX = 0.5,
  referenceTag,
  referenceY = SIMPLE_STIMULUS_GEOMETRY.referenceY, showReference = true, compactCards = targets.length > 2,
  showFrequencyLabels = false, surface = "standard", targetAppearance = "card", stimulusFootprint = "seat", targetSize = "standard", showSolidFixationPoint = false, fixationMode = "fixed", stimulusStartTimestamp, stimulusEndTimestamp, debugTiming = false, selectedTargetIndex = null, onTargetClick, onGeometryChange, onResizeWhileActive, onTimingDisruption, onTimingFault }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduleFrameRef = useRef<(() => void) | null>(null);
  const stopFrameRef = useRef<(() => void) | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const failedAssetsRef = useRef(new Set<string>());
  const callbacksRef = useRef({ onFirstFrame, onFrameStats, onTimingStats, onDealComplete, onGeometryChange, onResizeWhileActive, onTimingDisruption, onTimingFault });
  callbacksRef.current = { onFirstFrame, onFrameStats, onTimingStats, onDealComplete, onGeometryChange, onResizeWhileActive, onTimingDisruption, onTimingFault };
  const propsRef = useRef({ active, dealing, targets, activeTargetIndex, refreshRateHz, luminanceBaseline, modulationAmplitude, modulationDepth, referenceLabel, referenceTag, referenceX, referenceY, showReference, compactCards, showFrequencyLabels, surface, targetAppearance, stimulusFootprint, targetSize, showSolidFixationPoint, stimulusStartTimestamp, stimulusEndTimestamp, debugTiming, selectedTargetIndex });
  propsRef.current = { active, dealing, targets, activeTargetIndex, refreshRateHz, luminanceBaseline, modulationAmplitude, modulationDepth, referenceLabel, referenceTag, referenceX, referenceY, showReference, compactCards, showFrequencyLabels, surface, targetAppearance, stimulusFootprint, targetSize, showSolidFixationPoint, stimulusStartTimestamp, stimulusEndTimestamp, debugTiming, selectedTargetIndex };

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext("2d"); if (!context) return;
    let animation = 0, frameIndex = 0, firstFrame = 0, phaseStart = 0, lastFrame = 0, dropped = 0, lastDebug = 0;
    let animationStart = performance.now();
    let disposed = false;
    let dealSettledFrame = false;
    let dealCompleteNotified = false;
    let assetsReady = false;
    let wasDealing = false;
    let wasActive = false;
    let timingFaultNotified = false;
    let cachedBackground: HTMLCanvasElement | null = null;
    let cachedDesk: HTMLCanvasElement | null = null;
    let cachedCards: { image: HTMLCanvasElement; x: number; y: number; width: number; height: number }[] = [];
    let maxDrawDurationMs = 0;
    const intervals: number[] = [];
    const timingQuality = new StimulusTimingQuality();
    let lastTimingWarning = false;
    let lastTimingPublish = 0;
    const frameStatsSnapshot = () => {
      if (frameIndex === 0) return;
      const sortedIntervals = intervals.slice().sort((a, b) => a - b);
      const medianInterval = sortedIntervals.length ? sortedIntervals[Math.floor(sortedIntervals.length / 2)] : 1_000 / propsRef.current.refreshRateHz;
      return { firstFramePerformanceMs: firstFrame, lastFramePerformanceMs: lastFrame,
        renderedFrames: frameIndex, suspectedDroppedFrames: dropped, measuredRefreshRateHz: 1_000 / medianInterval,
        expectedRefreshRateHz: propsRef.current.refreshRateHz, maxFrameIntervalMs: Math.max(0, ...intervals), maxDrawDurationMs };
    };
    const reportFrameStats = () => { const stats = frameStatsSnapshot(); if (stats) callbacksRef.current.onFrameStats?.(stats); };
    const stopActive = () => {
      if (!wasActive) return;
      wasActive = false;
      reportFrameStats();
    };
    stopFrameRef.current = stopActive;
    const notifyTimingFault = () => {
      if (timingFaultNotified) return;
      timingFaultNotified = true;
      callbacksRef.current.onTimingFault?.();
    };

    let geometry: ResponsiveStimulusGeometrySnapshot | null = null;
    let previousDisplayScale: number | null = null;
    let resizeWhileActiveNotified = false;
    const suitAssetIndex: Record<string, number> = { "♦": 1, "♣": 2, "♥": 3, "♠": 4 };
    const imageWaiters = new Map<string, Promise<void>>();
    let redraw = () => {};
    const cardImage = (label: string) => {
      const suit = label.slice(-1), rank = label.slice(0, -1);
      const filename = `${rank}-${suitAssetIndex[suit]}.png`;
      let image = imageCacheRef.current.get(filename);
      if (!image) {
        image = new Image();
        image.onload = () => { if (!disposed) redraw(); };
        image.onerror = () => { if (!disposed) { failedAssetsRef.current.add(filename); redraw(); } };
        image.src = new URL(`./cards/${filename}`, document.baseURI).href;
        imageCacheRef.current.set(filename, image);
      }
      return image;
    };
    const cardBackImage = () => {
      const filename = "card-back.svg";
      let image = imageCacheRef.current.get(filename);
      if (!image) {
        image = new Image();
        image.onload = () => { if (!disposed) redraw(); };
        image.onerror = () => { if (!disposed) { failedAssetsRef.current.add(filename); redraw(); } };
        image.src = new URL(`./cards/${filename}`, document.baseURI).href;
        imageCacheRef.current.set(filename, image);
      }
      return image;
    };
    const feltTextureImage = () => {
      const filename = "felt-fibers-1k.jpg";
      let image = imageCacheRef.current.get(filename);
      if (!image) {
        image = new Image();
        image.onload = () => { if (!disposed) redraw(); };
        image.onerror = () => { if (!disposed) { failedAssetsRef.current.add(filename); redraw(); } };
        image.src = new URL(`./textures/${filename}`, document.baseURI).href;
        imageCacheRef.current.set(filename, image);
      }
      return image;
    };
    const prepareAssets = () => {
      const current = propsRef.current;
      if (current.targetAppearance === "solid") { assetsReady = true; return; }
      if (current.surface === "game") cardBackImage();
      const labels = [current.referenceLabel, ...current.targets.map((target) => target.label)];
      const unique = [...new Set(labels)];
      const waits = unique.map((label) => {
        const image = cardImage(label);
        const suit = label.slice(-1), rank = label.slice(0, -1);
        const filename = `${rank}-${suitAssetIndex[suit]}.png`;
        if (image.complete) {
          if (image.naturalWidth === 0) failedAssetsRef.current.add(filename);
          return Promise.resolve();
        }
        const existing = imageWaiters.get(filename);
        if (existing) return existing;
        const wait = new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
        imageWaiters.set(filename, wait);
        return wait;
      });
      if (current.surface === "game") {
        const back = cardBackImage();
        if (!back.complete) waits.push(new Promise<void>(resolve => {
          back.addEventListener("load", () => resolve(), { once: true });
          back.addEventListener("error", () => resolve(), { once: true });
        }));
        const felt = feltTextureImage();
        if (!felt.complete) waits.push(new Promise<void>(resolve => {
          felt.addEventListener("load", () => resolve(), { once: true });
          felt.addEventListener("error", () => resolve(), { once: true });
        }));
      }
      Promise.all(waits).then(() => { if (!disposed) { assetsReady = true; redraw(); } });
    };
    // Opaque light/dark concentric circles stay visible at both luminance extremes.
    const drawFixationPoint = (painter: CanvasRenderingContext2D, x: number, y: number, luminance: number | null = null) => {
      const factor = fixationMode === "synchronous" && luminance !== null ? modulationLevel(luminance, propsRef.current.modulationDepth) / 255 : 1;
      const color = (r: number, g: number, b: number) => `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
      painter.save();
      painter.shadowColor = "transparent"; painter.shadowBlur = 0; painter.shadowOffsetX = 0; painter.shadowOffsetY = 0;
      painter.fillStyle = color(248, 244, 233); painter.beginPath(); painter.arc(x, y, compactCards ? 8 : 10, 0, Math.PI * 2); painter.fill();
      painter.strokeStyle = color(37, 43, 39); painter.lineWidth = compactCards ? 4 : 5; painter.beginPath(); painter.arc(x, y, compactCards ? 5 : 6, 0, Math.PI * 2); painter.stroke();
      painter.fillStyle = color(37, 43, 39); painter.beginPath(); painter.arc(x, y, compactCards ? 2.5 : 3, 0, Math.PI * 2); painter.fill();
      painter.restore();
    };
    const shadeCardFace = (painter: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, brightness: number) => {
      // Face-specific contrast: original pixels at the bright peak, 5% at the
      // dark trough. Clip so neither surround nor shadow flashes.
      painter.save(); painter.shadowColor = "transparent"; painter.shadowBlur = 0;
      roundedRect(painter, x, y, width, height, 10); painter.clip();
      painter.globalAlpha = 1 - brightness;
      painter.fillStyle = "#000"; painter.fillRect(x, y, width, height); painter.restore();
    };
    const drawCard = (x: number, y: number, label: string, luminance: number | null, cardWidth: number, cardHeight: number, ring: number, scale = 1, rotation = 0, frequencyLabel?: string, shadowBlur = 7, shadowOffsetY = 3, ringYOverride?: number, depthOverride?: number, painter = context, paintRing = true) => {
      const centerX = x, centerY = y;
      const ringY = ringYOverride ?? ring;
      painter.save(); painter.translate(x, y); painter.rotate(rotation); painter.scale(scale, scale); x = 0; y = 0;
      if (luminance !== null && paintRing && propsRef.current.targetAppearance !== "card-face") {
        // The luminance seat is the complete stimulus surface. Keep the
        // drawing state clean so no decorative outline or shadow surrounds it.
        painter.shadowColor = "transparent"; painter.shadowBlur = 0; painter.shadowOffsetX = 0; painter.shadowOffsetY = 0;
        const level = modulationLevel(luminance, depthOverride ?? propsRef.current.modulationDepth);
        painter.fillStyle = `rgb(${level},${level},${propsRef.current.targetAppearance === "solid" ? level : Math.min(230, level + 5)})`;
        const faceOnly = propsRef.current.stimulusFootprint === "card";
        roundedRect(painter, x - cardWidth / 2 - (faceOnly ? 0 : ring), y - cardHeight / 2 - (faceOnly ? 0 : ringY), cardWidth + (faceOnly ? 0 : ring * 2), cardHeight + (faceOnly ? 0 : ringY * 2), faceOnly ? 10 : 16);
        painter.fill();
      }
      if (propsRef.current.targetAppearance !== "solid") {
      painter.shadowColor = "rgba(0,0,0,.24)"; painter.shadowBlur = shadowBlur; painter.shadowOffsetX = 3; painter.shadowOffsetY = shadowOffsetY;
      painter.fillStyle = "#fff";
      roundedRect(painter, x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, 10); painter.fill();
      painter.shadowColor = "transparent"; painter.shadowBlur = 0; painter.shadowOffsetX = 0; painter.shadowOffsetY = 0;
      const image = cardImage(label);
      if (image.complete && image.naturalWidth > 0) {
        painter.save(); roundedRect(painter, x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, 10); painter.clip();
        painter.drawImage(image, x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight); painter.restore();
      } else if (failedAssetsRef.current.has(`${label.slice(0, -1)}-${suitAssetIndex[label.slice(-1)]}.png`)) {
        painter.fillStyle = "#8f2830"; painter.font = "600 11px system-ui, sans-serif"; painter.textAlign = "center"; painter.textBaseline = "middle";
        painter.fillText("牌面资源不可用", 0, 0);
      }
      painter.strokeStyle = "rgba(35,31,25,.28)"; painter.lineWidth = 1;
      roundedRect(painter, x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, 10); painter.stroke();
      if (luminance !== null) {
        if (propsRef.current.targetAppearance === "card-face" && paintRing) shadeCardFace(painter, x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight, cardFaceBrightness(luminance, depthOverride ?? propsRef.current.modulationDepth));
        drawFixationPoint(painter, 0, 0, paintRing ? luminance : null);
      }
      }
      if (propsRef.current.targetAppearance === "solid" && propsRef.current.showSolidFixationPoint && luminance !== null) drawFixationPoint(painter, 0, 0, luminance);
      painter.restore();
      if (showFrequencyLabels && frequencyLabel) {
        painter.save(); painter.fillStyle = "rgba(244,239,224,.92)"; painter.font = "600 14px system-ui, sans-serif";
        painter.textAlign = "center"; painter.textBaseline = "top"; painter.fillText(frequencyLabel, centerX, centerY + cardHeight / 2 + ringY + 9); painter.restore();
      }
    };
    const easeOut = (value: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
    const deckGeometry = (width: number, height: number) => {
      // Keep the visible deck and the deal origin in sync while giving the
      // six-target composition a little more visual weight on larger tables.
      const deckProps = propsRef.current;
      const deckScale = deckProps.compactCards && deckProps.targets.length === 6 ? .117 : .11;
      const deckWidth = Math.max(72, Math.min(119, Math.min(width, height) * deckScale));
      const deckHeight = deckWidth * (190 / 136);
      const edge = Math.max(18, Math.min(44, Math.min(width, height) * .04));
      return { x: width - edge - deckWidth, y: Math.max(edge, height * (deckProps.surface === "game" ? GAME_DECK_TOP_RATIO : .08)), width: deckWidth, height: deckHeight };
    };
    const drawDeck = (width: number, height: number) => {
      const deck = deckGeometry(width, height);
      const image = cardBackImage();
      context.save();
      context.shadowColor = "rgba(15,8,6,.34)"; context.shadowBlur = 11; context.shadowOffsetX = 5; context.shadowOffsetY = 7;
      for (const offset of [7, 4, 0]) {
        context.save();
        roundedRect(context, deck.x - offset, deck.y - offset, deck.width, deck.height, 8); context.clip();
        if (image.complete && image.naturalWidth > 0) {
          context.drawImage(image, deck.x - offset, deck.y - offset, deck.width, deck.height);
        } else {
          context.fillStyle = "#4a2730"; context.fillRect(deck.x - offset, deck.y - offset, deck.width, deck.height);
          context.strokeStyle = "rgba(224,201,159,.8)"; context.lineWidth = 2;
          roundedRect(context, deck.x - offset + 5, deck.y - offset + 5, deck.width - 10, deck.height - 10, 6); context.stroke();
        }
        context.restore();
      }
      context.shadowColor = "transparent"; context.shadowBlur = 0; context.shadowOffsetX = 0; context.shadowOffsetY = 0;
      context.restore();
      return deck;
    };
    const dealCard = (timestamp: number, targetX: number, targetY: number, label: string, startMs: number, durationMs: number, rotationStart = 0, cardWidthOverride?: number, cardHeightOverride?: number, ringOverride?: number, ringYOverride?: number) => {
      const progress = easeOut((timestamp - animationStart - startMs) / durationMs); if (progress <= 0) return;
      const deck = deckGeometry(canvas.clientWidth, canvas.clientHeight);
      const deckX = deck.x + deck.width / 2, deckY = deck.y + deck.height / 2;
      drawCard(deckX + (targetX - deckX) * progress, deckY + (targetY - deckY) * progress, label, null,
        cardWidthOverride ?? geometry?.cardWidth ?? 88, cardHeightOverride ?? geometry?.cardHeight ?? 124, ringOverride ?? geometry?.ringX ?? geometry?.ring ?? 24,
        .82 + .18 * progress, (1 - progress) * rotationStart, undefined, 12 - 5 * progress, 7 - 4 * progress, ringYOverride ?? geometry?.ringY);
    };
    const draw = (timestamp: number) => {
      const drawStarted = performance.now();
      // requestAnimationFrame handles are one-shot. Clear the consumed handle
      // before deciding whether another frame is needed, otherwise a completed
      // dealing frame can prevent the next stimulus phase from starting RAF.
      animation = 0;
      const current = propsRef.current;
      const isActive = current.active && (current.stimulusEndTimestamp === undefined || timestamp < current.stimulusEndTimestamp);
      // On idle game entry, paint the complete desk once its assets are ready,
      // instead of painting a placeholder and repainting each arriving image.
      if (current.surface === "game" && !isActive && !current.dealing && !assetsReady) return;
      const { dealing: isDealing, targets: currentTargets, activeTargetIndex: currentActiveTargetIndex,
        refreshRateHz: currentRefreshRateHz, luminanceBaseline: currentBaseline, modulationAmplitude: currentAmplitude,
        referenceLabel: currentReferenceLabel, referenceTag: currentReferenceTag, showReference: currentShowReference, showFrequencyLabels: currentShowFrequencyLabels, surface: currentSurface } = current;
      if (isDealing && !wasDealing) {
        animationStart = timestamp;
        dealSettledFrame = false;
        dealCompleteNotified = false;
        assetsReady = false;
        prepareAssets();
      }
      if (isActive && !wasActive) {
        resizeWhileActiveNotified = false;
        // React may change the surrounding layout when starting a run. Resolve
        // that layout before the first stimulus frame becomes the baseline.
        resize();
        // The complete static background is already cached; the dealing-only
        // desk texture is no longer needed during stimulation.
        if (cachedDesk) { cachedDesk.width = cachedDesk.height = 0; cachedDesk = null; }
        frameIndex = 0;
        firstFrame = timestamp;
        phaseStart = current.stimulusStartTimestamp ?? timestamp; lastDebug = timestamp;
        lastFrame = 0;
        dropped = 0;
        timingFaultNotified = false;
        timingQuality.reset(); lastTimingWarning = false;
        maxDrawDurationMs = 0;
        intervals.length = 0;
      }
      if (!isActive && wasActive) stopActive();
      wasDealing = isDealing;
      wasActive = isActive;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      // Only luminance seats change during stimulation. Restore their small
      // background regions and composite cards at the bounded raster scale.
      // This keeps texture rasterization, shadows, image scaling and text out
      // of the repeated frame path without changing the stimulus waveform.
      if (isActive && !isDealing && cachedBackground && geometry) {
        const dpr = geometry.devicePixelRatio;
        currentTargets.forEach((target, index) => {
          const sprite = cachedCards[index], resolved = geometry?.targets[index];
          if (!sprite || !resolved) return;
          context.drawImage(cachedBackground!, sprite.x * dpr, sprite.y * dpr, sprite.width * dpr, sprite.height * dpr,
            sprite.x, sprite.y, sprite.width, sprite.height);
          const targetActive = currentActiveTargetIndex === null || currentActiveTargetIndex === index;
          const luminance = targetActive ? stimulusLuminanceAt(timestamp, phaseStart, target.frequencyHz, target.phaseRad, currentBaseline, currentAmplitude) : currentBaseline;
          const level = modulationLevel(luminance, current.modulationDepth);
          context.fillStyle = `rgb(${level},${level},${current.targetAppearance === "solid" ? level : Math.min(230, level + 5)})`;
          const region = current.stimulusFootprint === "card" ? resolved.card : resolved.ring;
          if (current.targetAppearance !== "card-face") {
            roundedRect(context, region.x, region.y, region.width, region.height, current.stimulusFootprint === "card" ? 10 : 16); context.fill();
          }
          // Solid targets have no static card overlay. Avoid compositing an
          // empty full-size texture over each enlarged flickering rectangle.
          if (current.targetAppearance !== "solid") {
            context.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height);
            if (current.targetAppearance === "card-face") {
              shadeCardFace(context, resolved.card.x, resolved.card.y, resolved.card.width, resolved.card.height, cardFaceBrightness(luminance, current.modulationDepth));
              drawFixationPoint(context, resolved.centerX, resolved.centerY, luminance);
            }
            else if (fixationMode === "synchronous") drawFixationPoint(context, resolved.centerX, resolved.centerY, luminance);
          }
          else if (current.showSolidFixationPoint) drawFixationPoint(context, resolved.centerX, resolved.centerY, luminance);
        });
      } else {
      context.clearRect(0, 0, width, height);
      if (currentSurface === "game") {
        if (cachedDesk) {
          context.drawImage(cachedDesk, 0, 0, width, height);
        } else {
        context.fillStyle = "#285f48"; context.fillRect(0, 0, width, height);
        const felt = feltTextureImage();
        if (felt.complete && felt.naturalWidth > 0) {
          // Fixed-size seamless fibers keep their physical scale on resize.
          // This is rasterized into cachedBackground, outside the active-frame path.
          const pattern = context.createPattern(felt, "repeat");
          if (pattern) {
            pattern.setTransform(new DOMMatrix().scale(512 / felt.naturalWidth));
            context.save(); context.globalCompositeOperation = "multiply"; context.globalAlpha = .72;
            context.fillStyle = pattern; context.fillRect(0, 0, width, height); context.restore();
          }
        }
        const glow = context.createRadialGradient(width * .5, height * .42, 20, width * .5, height * .42, Math.max(width, height) * .72);
        glow.addColorStop(0, "rgba(78,132,99,.24)"); glow.addColorStop(.62, "rgba(27,70,53,.08)"); glow.addColorStop(1, "rgba(9,30,23,.34)");
        context.fillStyle = glow; context.fillRect(0, 0, width, height);
        drawDeck(width, height);
        // Felt compositing, gradients and deck shadows are static throughout
        // dealing. Rasterize once rather than rebuilding them on every frame.
        if (assetsReady) {
          cachedDesk = document.createElement("canvas");
          cachedDesk.width = canvas.width; cachedDesk.height = canvas.height;
          cachedDesk.getContext("2d")?.drawImage(canvas, 0, 0);
        }
        }
      } else {
        context.fillStyle = "#174b38"; context.fillRect(0, 0, width, height);
        context.strokeStyle = "rgba(235,228,207,.035)"; context.lineWidth = 1;
        for (let line = 12; line < height; line += 18) { context.beginPath(); context.moveTo(0, line); context.lineTo(width, line + 5); context.stroke(); }
      }
      if (isDealing) {
        if (currentSurface !== "game") { context.fillStyle = "#8f2830"; roundedRect(context, width - 92, height - 75, 68, 92, 7); context.fill();
          context.strokeStyle = "rgba(255,255,255,.45)"; roundedRect(context, width - 87, height - 70, 58, 82, 5); context.stroke(); }
        const dealDurationMs = 980;
        const dealIntervalMs = 190;
        if (currentShowReference && geometry?.reference) dealCard(timestamp, geometry.reference.centerX, geometry.reference.centerY, currentReferenceLabel, 0, dealDurationMs, 0, geometry.reference.card.width, geometry.reference.card.height, 0, 0);
        currentTargets.forEach((target, index) => { const resolved = geometry?.targets[index]; if (resolved) dealCard(timestamp, resolved.centerX, resolved.centerY, target.label, dealIntervalMs * (index + 1), dealDurationMs, (target.x < 0.5 ? -1 : target.x > 0.5 ? 1 : 0) * 7 * Math.PI / 180, undefined, undefined, geometry?.ringX, geometry?.ringY); });
        const lastCardEnd = Math.max(dealDurationMs, dealIntervalMs * currentTargets.length + dealDurationMs);
        if (timestamp - animationStart >= lastCardEnd && assetsReady) {
          if (dealSettledFrame) {
            if (!dealCompleteNotified) { dealCompleteNotified = true; callbacksRef.current.onDealComplete?.(); }
          } else {
            dealSettledFrame = true;
          }
        }
      } else {
        if (currentShowReference && geometry?.reference) {
          drawCard(geometry.reference.centerX, geometry.reference.centerY, currentReferenceLabel, null, geometry.reference.card.width, geometry.reference.card.height, 0);
          if (currentReferenceTag) {
            context.save(); context.fillStyle = "rgba(244,239,224,.9)"; context.font = "600 12px system-ui, sans-serif";
            context.textAlign = "center"; context.textBaseline = "bottom";
            context.fillText(currentReferenceTag, geometry.reference.centerX, geometry.reference.centerY - geometry.cardHeight / 2 - 8); context.restore();
          }
        }
      // Capture the desk and reference before adding target cards. The cache
      // is normally prepared while idle, before the first stimulus timestamp.
      if (cachedBackground) cachedBackground.width = cachedBackground.height = 0;
      cachedCards.forEach(sprite => { sprite.image.width = sprite.image.height = 0; });
      cachedBackground = document.createElement("canvas");
      cachedBackground.width = canvas.width; cachedBackground.height = canvas.height;
      cachedBackground.getContext("2d")?.drawImage(canvas, 0, 0);
      cachedCards = [];
      currentTargets.forEach((target, index) => {
        const targetActive = isActive && (currentActiveTargetIndex === null || currentActiveTargetIndex === index);
        const luminance = targetActive
          ? stimulusLuminanceAt(timestamp, phaseStart, target.frequencyHz, target.phaseRad, currentBaseline, currentAmplitude)
          : currentBaseline;
        const currentGeometry = geometry;
        const resolved = currentGeometry?.targets[index];
        if (resolved && currentGeometry) drawCard(resolved.centerX, resolved.centerY, target.label, luminance, currentGeometry.cardWidth, currentGeometry.cardHeight, currentGeometry.ringX ?? currentGeometry.ring, 1, 0, currentShowFrequencyLabels ? `${target.frequencyHz} Hz` : undefined, 7, 3, currentGeometry.ringY ?? currentGeometry.ring);
        if (resolved && currentGeometry) {
          const dpr = currentGeometry.devicePixelRatio;
          const x = Math.max(0, Math.floor(resolved.ring.x - 1)), y = Math.max(0, Math.floor(resolved.ring.y - 1));
          const spriteWidth = Math.min(width - x, Math.ceil(resolved.ring.x + resolved.ring.width + 1) - x);
          const spriteHeight = Math.min(height - y, Math.ceil(resolved.ring.y + resolved.ring.height + 1) - y);
          const image = document.createElement("canvas");
          image.width = Math.ceil(spriteWidth * dpr); image.height = Math.ceil(spriteHeight * dpr);
          const painter = image.getContext("2d");
          if (painter) {
            painter.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
            drawCard(resolved.centerX, resolved.centerY, target.label, currentBaseline, currentGeometry.cardWidth, currentGeometry.cardHeight,
              currentGeometry.ringX ?? currentGeometry.ring, 1, 0, currentShowFrequencyLabels ? `${target.frequencyHz} Hz` : undefined,
              7, 3, currentGeometry.ringY ?? currentGeometry.ring, undefined, painter, false);
          }
          cachedCards.push({ image, x, y, width: image.width / dpr, height: image.height / dpr });
        }
      });
      }
      }
      if (!isActive && current.selectedTargetIndex !== null && current.selectedTargetIndex !== undefined) {
        const selected = geometry?.targets[current.selectedTargetIndex];
        if (selected) {
          context.save(); context.strokeStyle = "#d3bd7e"; context.lineWidth = 3;
          roundedRect(context, selected.ring.x, selected.ring.y, selected.ring.width, selected.ring.height, 16); context.stroke(); context.restore();
        }
      }
      if (isActive) {
        maxDrawDurationMs = Math.max(maxDrawDurationMs, performance.now() - drawStarted);
        if (frameIndex === 0) callbacksRef.current.onFirstFrame?.(timestamp);
        if (lastFrame > 0) {
          const interval = timestamp - lastFrame; intervals.push(interval);
          const quality = timingQuality.sample(timestamp, interval, currentRefreshRateHz);
          dropped += quality.lostFrames;
          const tolerant = callbacksRef.current.onTimingDisruption;
          if (tolerant) {
            if (quality.invalidate || quality.warning !== lastTimingWarning) tolerant(quality.warning, quality.invalidate);
            lastTimingWarning = quality.warning;
            if (quality.severe) notifyTimingFault();
          } else if (quality.dropped) notifyTimingFault();
        }
        lastFrame = timestamp; frameIndex += 1;
        if (callbacksRef.current.onTimingStats && timestamp - lastTimingPublish >= 250) {
          lastTimingPublish = timestamp; const stats = frameStatsSnapshot(); if (stats) callbacksRef.current.onTimingStats(stats);
        }
        if (import.meta.env.DEV && current.debugTiming && timestamp - lastDebug >= 1000) {
          lastDebug = timestamp;
          const elapsedMs = Math.max(0, timestamp - phaseStart);
          console.debug("[stimulus timing]", { elapsedMs, expectedFrameIndex: Math.floor(elapsedMs * currentRefreshRateHz / 1000), renderedFrames: frameIndex, skippedFrames: dropped, maxRenderGapMs: Math.max(0, ...intervals), targets: currentTargets.map(target => {
            const phase = (2 * Math.PI * target.frequencyHz * elapsedMs / 1000 + target.phaseRad) % (2 * Math.PI);
            return { frequencyHz: target.frequencyHz, expectedPhase: phase, currentPhase: phase };
          }) });
        }
      }
      if (isActive || isDealing || (dealSettledFrame && !dealCompleteNotified)) animation = requestAnimationFrame(draw);
    };
    const resize = () => {
      const current = propsRef.current;
      const bounds = canvas.getBoundingClientRect();
      const displayScale = window.devicePixelRatio || 1;
      const displayScaleChanged = previousDisplayScale !== null && previousDisplayScale !== displayScale;
      previousDisplayScale = displayScale;
      const next = computeResponsiveStimulusGeometry({
        width: bounds.width,
        height: bounds.height,
        targets: current.targets,
        compactCards: current.compactCards,
        showReference: current.showReference,
        referenceX: current.referenceX,
        referenceY: current.referenceY,
        deckTopRatio: current.surface === "game" ? GAME_DECK_TOP_RATIO : undefined,
        devicePixelRatio: stimulusRenderScale(bounds.width, bounds.height, displayScale),
        targetSize: current.targetSize,
      });
      const previous = geometry;
      geometry = next;
      const changed = !previous || previous.backingWidth !== next.backingWidth || previous.backingHeight !== next.backingHeight
        || previous.cssWidth !== next.cssWidth || previous.cssHeight !== next.cssHeight || previous.devicePixelRatio !== next.devicePixelRatio;
      if (changed) {
        if (cachedBackground) cachedBackground.width = cachedBackground.height = 0;
        if (cachedDesk) cachedDesk.width = cachedDesk.height = 0;
        cachedCards.forEach(sprite => { sprite.image.width = sprite.image.height = 0; });
        cachedBackground = null;
        cachedDesk = null;
        cachedCards = [];
        canvas.width = next.backingWidth;
        canvas.height = next.backingHeight;
        context.setTransform(next.devicePixelRatio, 0, 0, next.devicePixelRatio, 0, 0);
      }
      callbacksRef.current.onGeometryChange?.(next);
      if (current.active && wasActive && (displayScaleChanged || hasSignificantStimulusResize(previous, next)) && !resizeWhileActiveNotified) {
        resizeWhileActiveNotified = true;
        callbacksRef.current.onResizeWhileActive?.();
      }
      if (!current.active) resizeWhileActiveNotified = false;
      if (changed) redraw();
    };
    redraw = () => {
      if (cachedBackground) cachedBackground.width = cachedBackground.height = 0;
      cachedBackground = null;
      const current = propsRef.current;
      // Asset loads and ResizeObserver can arrive together on page entry.
      // Coalesce their expensive full-desk paints into the next frame.
      if (!current.active && !current.dealing && !animation) animation = requestAnimationFrame(draw);
    };
    scheduleFrameRef.current = () => {
      if (!animation) animation = requestAnimationFrame(draw);
    };
    prepareAssets();
    resize();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      scheduleFrameRef.current = null;
      stopFrameRef.current = null;
      disposed = true;
      cancelAnimationFrame(animation); resizeObserver?.disconnect(); window.removeEventListener("resize", resize);
      stopActive();
      if (cachedBackground) cachedBackground.width = cachedBackground.height = 0;
      if (cachedDesk) cachedDesk.width = cachedDesk.height = 0;
      cachedCards.forEach(sprite => { sprite.image.width = sprite.image.height = 0; });
      cachedBackground = null; cachedDesk = null; cachedCards = [];
    };
  }, [targets, referenceLabel, referenceTag, referenceX, referenceY, showReference, compactCards, showFrequencyLabels, surface, targetAppearance, stimulusFootprint, targetSize, showSolidFixationPoint, fixationMode]);

  useEffect(() => { scheduleFrameRef.current?.(); }, [active, dealing, activeTargetIndex, refreshRateHz, luminanceBaseline, modulationAmplitude, modulationDepth, selectedTargetIndex, stimulusStartTimestamp, stimulusEndTimestamp]);
  useEffect(() => { if (!active) stopFrameRef.current?.(); }, [active]);

  const simpleGeometry = compactCards === false || targets.length <= 2;
  return <canvas ref={canvasRef} className={`stimulus-canvas ${simpleGeometry ? "simple-geometry-v2" : ""} ${onTargetClick ? "clickable" : ""}`} aria-label={targetAppearance === "solid" ? "SSVEP 纯色刺激块" : "SSVEP 扑克牌刺激区"}
    onClick={(event) => {
      if (!onTargetClick) return;
      const bounds = event.currentTarget.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const geometry = computeResponsiveStimulusGeometry({ width: bounds.width, height: bounds.height, targets, compactCards, showReference, referenceX, referenceY, targetSize, deckTopRatio: surface === "game" ? GAME_DECK_TOP_RATIO : undefined });
      const index = geometry.targets.findIndex((target) => x >= target.ring.x && x <= target.ring.x + target.ring.width
        && y >= target.ring.y && y <= target.ring.y + target.ring.height);
      if (index >= 0) onTargetClick(index);
    }} />;
}
