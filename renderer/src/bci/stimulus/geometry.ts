import type { StimulusTarget } from "./types";

export const GAME_DECK_TOP_RATIO = 0.14;

export interface ResponsiveStimulusGeometryInput {
  width: number;
  height: number;
  targets: Pick<StimulusTarget, "x" | "y">[];
  compactCards?: boolean;
  showReference?: boolean;
  referenceX?: number;
  referenceY?: number;
  deckTopRatio?: number;
  devicePixelRatio?: number;
  targetSize?: "standard" | "diagnostic-large" | "teaching-fill" | "game-comfortable-v1" | "game-card-face-v2" | "game-open-v3" | "game-open-v4";
}

export interface ResponsiveStimulusGeometryTarget {
  centerX: number;
  centerY: number;
  card: { x: number; y: number; width: number; height: number };
  ring: { x: number; y: number; width: number; height: number };
  label: { x: number; y: number; width: number; height: number };
}

export interface ResponsiveStimulusGeometrySnapshot {
  version: "responsive-geometry-v1";
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  targetCount: number;
  cardWidth: number;
  cardHeight: number;
  widthToHeightRatio: number;
  heightToWidthRatio: number;
  ring: number;
  ringX: number;
  ringY: number;
  targets: ResponsiveStimulusGeometryTarget[];
  reference: ResponsiveStimulusGeometryTarget | null;
  sizeProfile?: "game-comfortable-v1" | "game-card-face-v2" | "game-open-v3" | "game-open-v4";
  sizeScale?: number;
}

/** Resize threshold shared by StimulusTable's active-run safety guard. */
export function hasSignificantStimulusResize(previous: Pick<ResponsiveStimulusGeometrySnapshot, "cssWidth" | "cssHeight" | "devicePixelRatio"> | null,
  next: Pick<ResponsiveStimulusGeometrySnapshot, "cssWidth" | "cssHeight" | "devicePixelRatio">,
  dimensionThreshold = 8): boolean {
  return Boolean(previous && (Math.abs(previous.cssWidth - next.cssWidth) > dimensionThreshold
    || Math.abs(previous.cssHeight - next.cssHeight) > dimensionThreshold
    || previous.devicePixelRatio !== next.devicePixelRatio));
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/**
 * Resolve all drawable and hit-test geometry from the current CSS container.
 * Existing normalized target positions remain the source of spatial intent;
 * dimensions are reduced when a small/packed container would otherwise cause
 * overlap.  The snapshot is intentionally independent of stimulus timing.
 */
export function computeResponsiveStimulusGeometry(input: ResponsiveStimulusGeometryInput): ResponsiveStimulusGeometrySnapshot {
  const width = Math.max(1, Number.isFinite(input.width) ? input.width : 1);
  const height = Math.max(1, Number.isFinite(input.height) ? input.height : 1);
  const dpr = clamp(Number.isFinite(input.devicePixelRatio ?? 1) ? (input.devicePixelRatio ?? 1) : 1, 0.5, 4);
  if (input.targetSize === "game-open-v3" || input.targetSize === "game-open-v4") {
    const scale = input.targetSize === "game-open-v4" ? 1.05 : 1;
    const count = input.targets.length, usable = Math.max(60, height - 52), edge = 12;
    const shiftY = input.targetSize === "game-open-v4" ? Math.min(22, usable * .025) : 0;
    const cardHeight = Math.min(usable * (count === 2 ? .46 : .42), width * (count === 6 ? .18 : .22) * 190 / 136, 400) * scale;
    const cardWidth = cardHeight * 136 / 190, ring = 8;
    const make = (x: number, y: number, w = cardWidth, h = cardHeight, margin = ring): ResponsiveStimulusGeometryTarget => {
      const cx = width * x, cy = edge + usable * y + shiftY;
      return { centerX:cx,centerY:cy,card:{x:cx-w/2,y:cy-h/2,width:w,height:h},
        ring:{x:cx-w/2-margin,y:cy-h/2-margin,width:w+2*margin,height:h+2*margin},
        label:{x:cx-w/2-margin,y:cy+h/2+margin+6,width:w+2*margin,height:22} };
    };
    const points = count === 2 ? [[.21,.68],[.79,.68]] : count === 4 ? [[.22,.215],[.78,.215],[.22,.785],[.78,.785]]
      : [[.30,.215],[.565,.215],[.83,.215],[.30,.785],[.565,.785],[.83,.785]];
    const rw = Math.min(count === 2 ? 220 : count === 4 ? 200 : 180, usable * (count === 2 ? .40 : count === 4 ? .39 : .36) * 136 / 190) * scale;
    return {version:"responsive-geometry-v1",cssWidth:width,cssHeight:height,devicePixelRatio:dpr,backingWidth:Math.round(width*dpr),backingHeight:Math.round(height*dpr),
      targetCount:count,cardWidth,cardHeight,widthToHeightRatio:136/190,heightToWidthRatio:190/136,ring,ringX:ring,ringY:ring,
      targets:input.targets.map((_,i)=>make(points[i][0],points[i][1])),reference:input.showReference === false ? null : make(count===6?.09:.5,count===2?.22:.5,rw,rw*190/136,0),sizeProfile:input.targetSize};
  }
  if (input.targetSize === "game-card-face-v2") {
    const base = computeResponsiveStimulusGeometry({ ...input, targetSize: "game-comfortable-v1" });
    // Reuse the validated seats/centres. Grow faces into their former surround,
    // reserving shadow clearance; reference/deck geometry is unchanged.
    const scale = Math.max(1, Math.min(1.12,
      (base.cardWidth + 2 * base.ringX - 8) / base.cardWidth,
      (base.cardHeight + 2 * base.ringY - 8) / base.cardHeight));
    const cardWidth = base.cardWidth * scale, cardHeight = base.cardHeight * scale;
    return { ...base, sizeProfile: "game-card-face-v2", sizeScale: (base.sizeScale ?? 1) * scale,
      cardWidth, cardHeight, ringX: base.ringX - (cardWidth - base.cardWidth) / 2,
      ringY: base.ringY - (cardHeight - base.cardHeight) / 2,
      ring: Math.min(base.ringX - (cardWidth - base.cardWidth) / 2, base.ringY - (cardHeight - base.cardHeight) / 2),
      targets: base.targets.map(t => ({ ...t, card: { x: t.centerX - cardWidth / 2, y: t.centerY - cardHeight / 2, width: cardWidth, height: cardHeight } })) };
  }
  if (input.targetSize === "game-comfortable-v1") {
    const original = computeResponsiveStimulusGeometry({ ...input, targetSize: "standard" });
    const shortSide = Math.min(width, height);
    const desired = clamp(1.12 + (shortSide - 400) * .000325, 1.12, 1.25);
    const grow = (target: ResponsiveStimulusGeometryTarget, scale: number): ResponsiveStimulusGeometryTarget => {
      const rect = (r: typeof target.card) => ({ x: target.centerX + (r.x - target.centerX) * scale,
        y: target.centerY + (r.y - target.centerY) * scale, width: r.width * scale, height: r.height * scale });
      const card = rect(target.card), ring = rect(target.ring);
      return { ...target, card, ring, label: { x: ring.x, y: ring.y + ring.height + 6, width: ring.width, height: target.label.height } };
    };
    const overlap = (a: ResponsiveStimulusGeometryTarget["card"], b: ResponsiveStimulusGeometryTarget["card"]) =>
      a.x < b.x + b.width + 8 && b.x < a.x + a.width + 8 && a.y < b.y + b.height + 8 && b.y < a.y + a.height + 8;
    // Keep the established centres, ring/face ratio and deck footprint. Enlarge
    // only as far as the available space permits, including hidden label space.
    const deckWidth = clamp(shortSide * (input.compactCards && input.targets.length === 6 ? .117 : .11), 72, 119);
    const deckEdge = clamp(shortSide * .04, 18, 44);
    const deck = { x: width - deckEdge - deckWidth - 7, y: Math.max(deckEdge, height * (input.deckTopRatio ?? GAME_DECK_TOP_RATIO)) - 7,
      width: deckWidth + 14, height: deckWidth * (190 / 136) + 14 };
    const fits = (scale: number) => {
      const targets = original.targets.map(target => grow(target, scale));
      const reference = original.reference && grow(original.reference, scale);
      const boxes = targets.map(target => ({ ...target.ring, height: target.ring.height + 6 + target.label.height }));
      if (reference) boxes.push({ x: reference.card.x, y: reference.card.y - 28, width: reference.card.width, height: reference.card.height + 28 });
      return boxes.every((box, index) => box.x >= 10 && box.y >= 10 && box.x + box.width <= width - 10 && box.y + box.height <= height - 10
        && !overlap(box, deck) && boxes.slice(index + 1).every(other => !overlap(box, other)));
    };
    let low = 1, high = desired;
    if (fits(low)) for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
    const scale = low;
    return { ...original, sizeProfile: "game-comfortable-v1", sizeScale: scale,
      cardWidth: original.cardWidth * scale, cardHeight: original.cardHeight * scale,
      ring: original.ring * scale, ringX: original.ringX * scale, ringY: original.ringY * scale,
      targets: original.targets.map(target => grow(target, scale)), reference: original.reference && grow(original.reference, scale) };
  }
  // Scale principle targets and their original surrounds together. Cells
  // only constrain placement: they do not stretch the grey flicker surface.
  if (input.targetSize === "teaching-fill" && input.targets.length >= 1 && input.targets.length <= 4 && input.showReference === false) {
    const columns = input.targets.length;
    const rows = 1;
    const edge = Math.min(26, Math.min(width, height) * .025);
    const columnGap = Math.min(28, width * .022);
    const rowGap = Math.min(24, height * .035);
    const cellWidth = (width - 2 * edge - (columns - 1) * columnGap) / columns;
    const cellHeight = (height - 2 * edge - (rows - 1) * rowGap) / rows;
    const labelHeight = Math.min(22, cellHeight * .18);
    const labelGap = Math.min(6, cellHeight * .06);
    const original = computeResponsiveStimulusGeometry({ ...input, targetSize: "standard" });
    const originalSeatWidth = original.cardWidth + original.ringX * 2;
    const originalSeatHeight = original.cardHeight + original.ringY * 2;
    // Reduce two-target views more than three-target views, including when
    // the available space has already limited the shared enlargement budget.
    const countScale = columns === 2 ? .8 : columns === 3 ? .9 : 1;
    const scale = Math.min(1.3, cellWidth / originalSeatWidth,
      (cellHeight - labelHeight - labelGap) / originalSeatHeight) * countScale;
    const cardWidth = original.cardWidth * scale;
    const cardHeight = original.cardHeight * scale;
    const ringX = original.ringX * scale;
    const ringY = original.ringY * scale;
    const seatWidth = originalSeatWidth * scale;
    const seatHeight = originalSeatHeight * scale;
    const targets = input.targets.map((_, index) => {
      const x = edge + (index % columns) * (cellWidth + columnGap) + (cellWidth - seatWidth) / 2;
      const y = edge + Math.floor(index / columns) * (cellHeight + rowGap)
        + (cellHeight - seatHeight - labelGap - labelHeight) / 2;
      return {
        centerX: x + seatWidth / 2, centerY: y + seatHeight / 2,
        card: { x: x + ringX, y: y + ringY, width: cardWidth, height: cardHeight },
        ring: { x, y, width: seatWidth, height: seatHeight },
        label: { x, y: y + seatHeight + labelGap, width: seatWidth, height: labelHeight },
      };
    });
    return { version: "responsive-geometry-v1", cssWidth: width, cssHeight: height, devicePixelRatio: dpr,
      backingWidth: Math.round(width * dpr), backingHeight: Math.round(height * dpr),
      targetCount: input.targets.length, cardWidth, cardHeight,
      widthToHeightRatio: cardWidth / cardHeight, heightToWidthRatio: cardHeight / cardWidth,
      ring: Math.min(ringX, ringY), ringX, ringY, targets, reference: null };
  }
  const rawPositions = input.targets.length ? input.targets : [{ x: 0.5, y: 0.5 }];
  // Keep the six-seat 3x2 meaning while opening the grid slightly around its
  // centre so the enlarged cards use the felt surface more evenly.
  const positions = Boolean(input.compactCards) && rawPositions.length === 6
    ? rawPositions.map((position) => ({
      x: 0.59 + (position.x - 0.59) * 1.15,
      y: 0.51 + (position.y - 0.51) * 1.2,
    }))
    : rawPositions;
  const targetCount = positions.length;
  // `compactCards` identifies the game-table presentation. Keep the teaching
  // stimulus at its established conservative scale while giving the game
  // difficulty layouts their denser 3/4-target composition.
  const compactGameLayout = Boolean(input.compactCards) && targetCount > 2;
  const shortSide = Math.min(width, height);
  const edge = Math.max(10, Math.min(32, shortSide * 0.035));
  const legacySixCardWidth = compactGameLayout && targetCount === 6 ? clamp(width * 0.0935, 104, 156) : 0;
  const legacySixStimulusWidth = legacySixCardWidth * 1.4;
  const legacySixRing = legacySixCardWidth > 0 ? (legacySixStimulusWidth - legacySixCardWidth) / 2 : 0;
  const legacySixStimulusHeight = legacySixCardWidth > 0 ? legacySixCardWidth * (190 / 136) + legacySixRing * 2 : 0;
  const normalizedGap = positions.length > 1
    ? Math.min(...positions.map((position, index) => positions.slice(index + 1).map((other) => Math.hypot((other.x - position.x) * width, (other.y - position.y) * height)).filter(Boolean)).flat())
    : Infinity;
  // Two-target mode retains its previously validated scale. Difficult-mode
  // layouts get their own size budget. Six-target previews have a dedicated
  // budget rather than inheriting the conservative teaching fallback.
  const largeDiagnostic = input.targetSize === "diagnostic-large" && targetCount <= 2;
  const baseCardWidth = targetCount === 2 || largeDiagnostic
    ? largeDiagnostic ? clamp(shortSide * 0.42, 160, 320) : clamp(shortSide * 0.25, 88, 168)
    : compactGameLayout && targetCount === 3
      ? clamp(shortSide * 0.29, 116, 148)
      : compactGameLayout && targetCount === 4
        ? clamp(shortSide * 0.3, 120, 150)
        : compactGameLayout && targetCount === 6
          // Keep the previously validated six-target footprint. The hotfix
          // must restore the card-to-stimulus ratio instead of enlarging the
          // flicker surface to compensate for a constrained canvas height.
          ? clamp(width * 0.0935, 104, 156)
        : clamp(shortSide * 0.22, 64, 112);
  const baseCardHeight = baseCardWidth * (190 / 136);
  const baseRing = targetCount === 2 || largeDiagnostic
    ? largeDiagnostic ? clamp(baseCardWidth * 0.32, 24, 76) : clamp(baseCardWidth * 0.32, 20, 48)
    : compactGameLayout && targetCount === 3
      ? clamp(baseCardWidth * 0.25, 20, 34)
      : compactGameLayout && targetCount === 4
        ? clamp(baseCardWidth * 0.23, 22, 34)
        : compactGameLayout && targetCount === 6
          ? clamp((legacySixStimulusWidth - baseCardWidth) / 2, 8, 30)
        : clamp(baseCardWidth * 0.27, 14, 28);
  const gapFactor = targetCount === 2 ? 0.62 : compactGameLayout && targetCount === 3 ? 0.92 : compactGameLayout && targetCount === 4 ? 0.9 : compactGameLayout && targetCount === 6 ? 0.78 : 0.62;
  const availableByGap = Number.isFinite(normalizedGap) ? Math.max(32, normalizedGap * gapFactor - baseRing * 2) : baseCardWidth;
  const labelHeight = 22;
  const labelGap = 6;
  const minimumRowGap = height >= 800 ? 16 : 10;
  // The six-seat layout has a central reference card as well as a deck in the
  // upper-right. Solve its largest candidate width against the actual
  // rectangles (including labels), rather than relying on paint order or a
  // fixed scale. This also makes the geometry safe for smaller containers.
  const resolvedReferenceY = input.referenceY ?? 0.24;
  const sixSafeWidthLimit = compactGameLayout && targetCount === 6
    ? (() => {
      const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      const fits = (candidate: number) => {
        const candidateHeight = baseCardHeight * (candidate / baseCardWidth);
        const candidateRingX = compactGameLayout && targetCount === 6
          ? Math.max(4, Math.min((legacySixStimulusWidth - candidate) / 2, candidate * 0.2))
          : Math.min(baseRing * (candidate / baseCardWidth), Math.max(8, (shortSide - candidate) * 0.12));
        const candidateRingY = compactGameLayout && targetCount === 6
          ? Math.max(3, Math.min((legacySixStimulusHeight - candidateHeight) / 2, candidate * 0.2))
          : candidateRingX;
        const referenceScale = 0.9;
        const referenceWidth = candidate * referenceScale;
        const referenceHeight = candidateHeight * referenceScale;
        const labelWidthForCandidate = Math.max(48, candidate + candidateRingX * 2);
        const centerFor = (x: number, y: number) => ({
          x: clamp(x * width, edge + candidate / 2 + candidateRingX, width - edge - candidate / 2 - candidateRingX),
          y: clamp(y * height, edge + candidateHeight / 2 + candidateRingY, height - edge - candidateHeight / 2 - candidateRingY - labelHeight),
        });
        const boxes = positions.map((position) => {
          const center = centerFor(position.x, position.y);
          return {
            ring: { x: center.x - candidate / 2 - candidateRingX, y: center.y - candidateHeight / 2 - candidateRingY, width: candidate + candidateRingX * 2, height: candidateHeight + candidateRingY * 2 },
            card: { x: center.x - candidate / 2, y: center.y - candidateHeight / 2, width: candidate, height: candidateHeight },
            label: { x: center.x - labelWidthForCandidate / 2, y: center.y + candidateHeight / 2 + candidateRingY + labelGap, width: labelWidthForCandidate, height: labelHeight },
          };
        });
        const referenceCenter = centerFor(input.referenceX ?? 0.5, resolvedReferenceY);
        const reference = { x: referenceCenter.x - referenceWidth / 2, y: referenceCenter.y - referenceHeight / 2, width: referenceWidth, height: referenceHeight };
        const deckScale = compactGameLayout && targetCount === 6 ? 0.117 : 0.11;
        const deckWidth = Math.max(72, Math.min(119, shortSide * deckScale));
        const deckHeight = deckWidth * (190 / 136);
        const deckEdge = Math.max(18, Math.min(44, shortSide * 0.04));
        const deck = { x: width - deckEdge - deckWidth - 7, y: Math.max(deckEdge, height * (input.deckTopRatio ?? 0.08)) - 7, width: deckWidth + 14, height: deckHeight + 14 };
        const targetCollision = boxes.some((box, index) => boxes.slice(index + 1).some((other) => overlaps(box.ring, other.ring)));
        const referenceCollision = boxes.some((box) => overlaps(box.ring, reference) || overlaps(box.label, reference));
        const labelCollision = boxes.some((box, index) => boxes.some((other, otherIndex) => index !== otherIndex && (overlaps(box.label, other.ring) || overlaps(box.label, other.card))));
        const deckCollision = boxes.some((box) => overlaps(box.ring, deck) || overlaps(box.label, deck));
        return !targetCollision && !referenceCollision && !labelCollision && !deckCollision;
      };
      let low = 24, high = baseCardWidth;
      for (let iteration = 0; iteration < 30; iteration += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle; else high = middle;
      }
      return low;
    })()
    : baseCardWidth;
  // Constrain width from both axes before deriving height so the card always
  // keeps the source 136:190 aspect ratio, including short containers.
  const widthByHeight = largeDiagnostic
    ? Math.max(24, (height - edge * 2 - labelHeight - labelGap) * baseCardWidth / (baseCardHeight + baseRing * 2))
    : Math.max(24, (height - edge * 2 - labelHeight - baseRing * 2) * baseCardWidth / baseCardHeight);
  // Four-target game layouts need a second, row-aware constraint. The old
  // size budget was chosen without accounting for the complete stimulus
  // surface (card + ring) in both rows, so at a short canvas the lower seat
  // could overlap the upper one. Solve the largest width whose two rows,
  // labels and required gap fit between the top/bottom safe edges.
  const fourRowWidthLimit = compactGameLayout && targetCount === 4
    ? (() => {
      const fits = (candidate: number) => {
        const candidateHeight = baseCardHeight * (candidate / baseCardWidth);
        const candidateRing = Math.min(baseRing * (candidate / baseCardWidth), Math.max(8, (shortSide - candidate) * 0.12));
        return 2 * candidateHeight + 4 * candidateRing <= height - edge * 2 - labelHeight - labelGap - minimumRowGap;
      };
      let low = 24, high = baseCardWidth;
      for (let iteration = 0; iteration < 28; iteration += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle; else high = middle;
      }
      return low;
    })()
    : baseCardWidth;
  const cardWidth = Math.min(baseCardWidth, fourRowWidthLimit, sixSafeWidthLimit, availableByGap, width - edge * 2, widthByHeight);
  const cardHeight = baseCardHeight * (cardWidth / baseCardWidth);
  const ring = Math.min(baseRing * (cardWidth / baseCardWidth), Math.max(8, (shortSide - cardWidth) * 0.12));
  const ringX = compactGameLayout && targetCount === 6
    ? Math.max(4, Math.min((legacySixStimulusWidth - cardWidth) / 2, cardWidth * 0.2))
    : ring;
  const ringY = compactGameLayout && targetCount === 6
    ? Math.max(3, Math.min((legacySixStimulusHeight - cardHeight) / 2, cardWidth * 0.2))
    : ring;
  const labelWidth = Math.max(48, cardWidth + ringX * 2);
  const referenceScale = compactGameLayout && targetCount === 6 ? 0.9 : 1;
  let fourRowCenters: { top: number; bottom: number } | null = null;
  if (compactGameLayout && targetCount === 4) {
    const sortedRows = [...new Set(positions.map((position) => position.y))].sort((a, b) => a - b);
    if (sortedRows.length >= 2) {
      const topDesired = sortedRows[0] * height;
      const bottomDesired = sortedRows[sortedRows.length - 1] * height;
      const minimumCenter = edge + cardHeight / 2 + ring;
      const maximumCenter = height - edge - cardHeight / 2 - ring - labelHeight;
    // Leave the top row's frequency label clear of the lower row's stimulus
    // surface while still meeting the visible inter-seat gap requirement.
    const requiredCenterGap = cardHeight + ring * 2 + labelGap + minimumRowGap;
      const top = Math.min(Math.max(topDesired, minimumCenter), maximumCenter - requiredCenterGap);
      const bottom = Math.max(Math.min(bottomDesired, maximumCenter), top + requiredCenterGap);
      fourRowCenters = { top, bottom };
    }
  }
  const makeTarget = (x: number, y: number, centerYOverride?: number, dimensions?: { width: number; height: number; ring: number; ringX?: number; ringY?: number }): ResponsiveStimulusGeometryTarget => {
    const targetCardWidth = dimensions?.width ?? cardWidth;
    const targetCardHeight = dimensions?.height ?? cardHeight;
    const targetRingX = dimensions?.ringX ?? dimensions?.ring ?? ringX;
    const targetRingY = dimensions?.ringY ?? dimensions?.ring ?? ringY;
    const targetLabelWidth = Math.max(48, targetCardWidth + targetRingX * 2);
    const centerX = clamp(x * width, edge + targetCardWidth / 2 + targetRingX, width - edge - targetCardWidth / 2 - targetRingX);
    const centerY = clamp(centerYOverride ?? y * height, edge + targetCardHeight / 2 + targetRingY, height - edge - targetCardHeight / 2 - targetRingY - labelHeight);
    return {
      centerX,
      centerY,
      card: { x: centerX - targetCardWidth / 2, y: centerY - targetCardHeight / 2, width: targetCardWidth, height: targetCardHeight },
      ring: { x: centerX - targetCardWidth / 2 - targetRingX, y: centerY - targetCardHeight / 2 - targetRingY, width: targetCardWidth + targetRingX * 2, height: targetCardHeight + targetRingY * 2 },
      label: { x: centerX - targetLabelWidth / 2, y: centerY + targetCardHeight / 2 + targetRingY + 6, width: targetLabelWidth, height: labelHeight },
    };
  };
  const reference = input.showReference === false ? null : makeTarget(input.referenceX ?? 0.5, resolvedReferenceY, undefined, { width: cardWidth * referenceScale, height: cardHeight * referenceScale, ring: 0 });
  return {
    version: "responsive-geometry-v1",
    cssWidth: width,
    cssHeight: height,
    devicePixelRatio: dpr,
    backingWidth: Math.round(width * dpr),
    backingHeight: Math.round(height * dpr),
    targetCount: input.targets.length,
    cardWidth,
    cardHeight,
    widthToHeightRatio: cardWidth / cardHeight,
    heightToWidthRatio: cardHeight / cardWidth,
    ring,
    ringX,
    ringY,
    targets: positions.map((target) => {
      const rowCenter = fourRowCenters
        ? target.y <= (Math.min(...positions.map((position) => position.y)) + Math.max(...positions.map((position) => position.y))) / 2
          ? fourRowCenters.top : fourRowCenters.bottom
        : undefined;
      return makeTarget(target.x, target.y, rowCenter);
    }),
    reference,
  };
}
